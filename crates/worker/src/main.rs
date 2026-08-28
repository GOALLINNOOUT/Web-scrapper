use mongodb::bson::{doc, to_bson, oid::ObjectId, Binary, DateTime, Bson};
use mongodb::options::UpdateOptions;
use redis::AsyncCommands;
use regex::Regex;
use scraper::{Html, Selector};
use std::collections::{HashSet, VecDeque};
use std::env;
use std::hash::{Hash, Hasher};
use std::sync::Arc;
use std::time::Duration;
use tokio::sync::Notify;
use tracing::{error, info, warn};
use url::Url;

use shared::{compress_data, get_mongo_client, get_redis_client, init_env, CrawlConfig, CrawlJob, PageContent, QueueJob};

const LIVE_EVENTS_CHANNEL: &str = "web-intel:live-events";

#[tokio::main]
async fn main() {
    init_env();
    tracing_subscriber::fmt::init();

    info!("Rust WebScrapper Worker starting...");

    let mongo_client = match get_mongo_client().await {
        Ok(client) => client,
        Err(e) => {
            error!("Failed to connect to MongoDB: {}", e);
            std::process::exit(1);
        }
    };

    let redis_client = match get_redis_client() {
        Ok(client) => client,
        Err(e) => {
            error!("Failed to connect to Redis: {}", e);
            std::process::exit(1);
        }
    };

    let shutdown = Arc::new(Notify::new());
    let shutdown_clone = shutdown.clone();

    tokio::spawn(async move {
        tokio::signal::ctrl_c().await.expect("Failed to listen for ctrl-c");
        info!("Shutdown signal received. Finishing current job...");
        shutdown_clone.notify_one();
    });

    let db_name = env::var("MONGODB_DB").unwrap_or_else(|_| "web_intelligence".to_string());
    let db = mongo_client.database(&db_name);
    let worker_id = env::var("WORKER_ID")
        .or_else(|_| env::var("HOSTNAME").map(|hostname| format!("rust-worker-{}", hostname)))
        .unwrap_or_else(|_| format!("rust-worker-{}", std::process::id()));
    let hostname = env::var("HOSTNAME").unwrap_or_else(|_| worker_id.clone());
    let mut completed_total: i64 = 0;
    let mut failed_total: i64 = 0;
    let mut last_heartbeat = std::time::Instant::now() - Duration::from_secs(30);
    let mut last_completed_total: i64 = 0;
    upsert_worker_metric(
        &db,
        &worker_id,
        &hostname,
        "idle",
        completed_total,
        failed_total,
        0.0,
    ).await.ok();

    let mut con = match redis_client.get_async_connection().await {
        Ok(conn) => conn,
        Err(e) => {
            error!("Failed to get Redis connection: {}", e);
            std::process::exit(1);
        }
    };

    loop {
        tokio::select! {
            _ = shutdown.notified() => {
                info!("Worker shutting down gracefully.");
                break;
            }
            res = con.brpop::<_, Option<(String, String)>>("webscrapper:jobs", 1.0) => {
                match res {
                    Ok(Some((_, payload))) => {
                        info!("Job received: {}", payload);
                        upsert_worker_metric(
                            &db,
                            &worker_id,
                            &hostname,
                            "active",
                            completed_total,
                            failed_total,
                            0.0,
                        ).await.ok();
                        if let Ok(queue_job) = serde_json::from_str::<QueueJob>(&payload) {
                            if let Ok(obj_id) = ObjectId::parse_str(&queue_job.crawl_id) {
                                if let Err(e) = process_job(&db, obj_id, &queue_job.device_id, &redis_client).await {
                                    error!("Error processing job {}: {}", queue_job.crawl_id, e);
                                    failed_total += 1;
                                } else {
                                    completed_total += 1;
                                }
                            }
                        }
                        let pages_per_sec = (completed_total - last_completed_total).max(0) as f64 / 10.0;
                        last_completed_total = completed_total;
                        upsert_worker_metric(
                            &db,
                            &worker_id,
                            &hostname,
                            "idle",
                            completed_total,
                            failed_total,
                            pages_per_sec,
                        ).await.ok();
                        last_heartbeat = std::time::Instant::now();
                    }
                    Ok(None) => {
                        if last_heartbeat.elapsed() >= Duration::from_secs(10) {
                            upsert_worker_metric(
                                &db,
                                &worker_id,
                                &hostname,
                                "idle",
                                completed_total,
                                failed_total,
                                0.0,
                            ).await.ok();
                            last_heartbeat = std::time::Instant::now();
                        }
                    }
                    Err(e) => {
                        error!("Redis BRPOP error: {}", e);
                        failed_total += 1;
                        upsert_worker_metric(
                            &db,
                            &worker_id,
                            &hostname,
                            "idle",
                            completed_total,
                            failed_total,
                            0.0,
                        ).await.ok();
                        tokio::time::sleep(Duration::from_secs(2)).await;
                    }
                }
            }
        }
    }
}

async fn upsert_worker_metric(
    db: &mongodb::Database,
    worker_id: &str,
    hostname: &str,
    status: &str,
    completed_total: i64,
    failed_total: i64,
    pages_per_sec: f64,
) -> Result<(), mongodb::error::Error> {
    let metrics = db.collection::<mongodb::bson::Document>("workermetrics");
    let now = DateTime::now();
    let failure_rate = if completed_total + failed_total > 0 {
        (failed_total as f64 / (completed_total + failed_total) as f64) * 100.0
    } else {
        0.0
    };
    metrics.update_one(
        doc! { "worker_id": worker_id },
        doc! {
            "$set": {
                "timestamp": now,
                "worker_id": worker_id,
                "worker_name": worker_id,
                "worker_type": "rust-redis",
                "instance_id": worker_id,
                "hostname": hostname,
                "queue_name": "webscrapper:jobs",
                "status": status,
                "cpu_percent": 0.0,
                "memory_mb": 0.0,
                "jobs_running": if status == "active" { 1 } else { 0 },
                "jobs_completed_total": completed_total,
                "jobs_failed_total": failed_total,
                "pages_per_sec": pages_per_sec,
                "restart_count": 0,
                "last_restart_at": null,
                "uptime_seconds": 0,
                "failure_rate_percent": failure_rate
            }
        },
        UpdateOptions::builder().upsert(true).build(),
    ).await?;
    Ok(())
}

#[derive(Clone)]
struct PageTask {
    current_url: String,
    depth: i32,
    parent_url: Option<String>,
    parent_page_id: Option<ObjectId>,
    request_index: usize,
}

struct FetchedPage {
    task: PageTask,
    parsed_url: Url,
    domain: String,
    html_content: String,
    headers: reqwest::header::HeaderMap,
}

struct FetchFailure {
    task: PageTask,
    domain: String,
    message: String,
}

struct StoredPageOutcome {
    url: String,
    depth: i32,
    page_id: ObjectId,
    links: Vec<String>,
    email_count: usize,
    social_count: usize,
    page_event: serde_json::Value,
}

async fn fetch_page_for_task(
    task: PageTask,
    seed_domain: String,
    config: CrawlConfig,
) -> Result<FetchedPage, FetchFailure> {
    let parsed_url = Url::parse(&task.current_url).map_err(|error| FetchFailure {
        task: task.clone(),
        domain: String::new(),
        message: error.to_string(),
    })?;
    let domain = parsed_url.domain().unwrap_or("").to_string();

    if config.same_domain_only && domain != seed_domain {
        return Err(FetchFailure {
            task,
            domain,
            message: "Out-of-domain URL skipped".to_string(),
        });
    }

    let client = build_request_client(task.request_index).map_err(|error| FetchFailure {
        task: task.clone(),
        domain: domain.clone(),
        message: error.to_string(),
    })?;

    if !is_allowed_by_robots(&client, &parsed_url, config.respect_robots).await {
        return Err(FetchFailure {
            task,
            domain,
            message: "robots.txt disallows this URL".to_string(),
        });
    }

    let response = client
        .get(&task.current_url)
        .header(reqwest::header::ACCEPT, "text/html,application/xhtml+xml")
        .header(reqwest::header::ACCEPT_LANGUAGE, "en-US,en;q=0.9")
        .send()
        .await
        .map_err(|error| FetchFailure {
            task: task.clone(),
            domain: domain.clone(),
            message: error.to_string(),
        })?;

    if !response.status().is_success() {
        return Err(FetchFailure {
            task,
            domain,
            message: format!("HTTP {}", response.status().as_u16()),
        });
    }

    let content_type = response.headers()
        .get(reqwest::header::CONTENT_TYPE)
        .and_then(|value| value.to_str().ok())
        .unwrap_or("")
        .to_ascii_lowercase();
    if !content_type.contains("text/html") && !content_type.contains("application/xhtml+xml") {
        return Err(FetchFailure {
            task,
            domain,
            message: format!("Unsupported content type: {}", content_type),
        });
    }

    let max_content_bytes = env_number("CRAWLER_MAX_CONTENT_BYTES", 2 * 1024 * 1024);
    if response.content_length().is_some_and(|length| length > max_content_bytes as u64) {
        return Err(FetchFailure {
            task,
            domain,
            message: "Page exceeds crawler size limit".to_string(),
        });
    }
    let headers = response.headers().clone();
    let html_content = match response.bytes().await {
        Ok(bytes) if bytes.len() <= max_content_bytes => String::from_utf8_lossy(&bytes).to_string(),
        Ok(bytes) => {
            return Err(FetchFailure {
                task,
                domain,
                message: format!("Page exceeds crawler size limit: {} bytes", bytes.len()),
            });
        }
        Err(error) => {
            return Err(FetchFailure {
                task,
                domain,
                message: error.to_string(),
            });
        }
    };

    Ok(FetchedPage {
        task,
        parsed_url,
        domain,
        html_content,
        headers,
    })
}

async fn store_fetched_page(
    page_col: &mongodb::Collection<mongodb::bson::Document>,
    device_id: &str,
    crawl_id: ObjectId,
    config: &CrawlConfig,
    email_regex: &Regex,
    fetched: FetchedPage,
) -> Result<StoredPageOutcome, Box<dyn std::error::Error>> {
    let document = Html::parse_document(&fetched.html_content);

    let metadata = if config.extract.metadata {
        extract_metadata(&document, &fetched.parsed_url)
    } else {
        serde_json::json!({})
    };
    let tech_stack = detect_tech_stack(&document, &fetched.html_content, &fetched.headers, &metadata);

    let mut links = Vec::new();
    if config.extract.links {
        let link_selector = Selector::parse("a[href]").unwrap();
        for element in document.select(&link_selector) {
            if let Some(href) = element.value().attr("href") {
                if let Ok(resolved) = fetched.parsed_url.join(href) {
                    let resolved_str = resolved.to_string();
                    if is_likely_page_url(&resolved) && !links.contains(&resolved_str) {
                        links.push(resolved_str);
                    }
                }
            }
        }
    }

    let mut emails = Vec::new();
    if config.extract.emails {
        let searchable = searchable_email_text(&fetched.html_content, &document);
        for mat in email_regex.find_iter(&searchable) {
            let email = mat.as_str().trim().to_ascii_lowercase();
            if is_useful_email(&email) && !emails.contains(&email) {
                emails.push(email);
            }
        }
        emails.sort();
    }

    let mut social = empty_social();
    if config.extract.social {
        for link in &links {
            if let Ok(parsed_social) = Url::parse(link) {
                if let Some(platform) = social_platform(&parsed_social) {
                    let canonical = canonical_social_url(parsed_social, platform);
                    let values = social[platform].as_array_mut().unwrap();
                    if !values.iter().any(|value| value.as_str() == Some(&canonical)) {
                        values.push(serde_json::Value::String(canonical));
                    }
                }
            }
        }
    }

    let (body_text, headings, paragraphs, word_count) = if config.extract.content {
        extract_content(&document)
    } else {
        (String::new(), Vec::new(), Vec::new(), 0)
    };
    let content_obj = PageContent {
        text: body_text.clone(),
        headings: headings.clone(),
        paragraphs: paragraphs.clone(),
        word_count,
    };
    let compressed_bytes = compress_data(&serde_json::to_vec(&content_obj)?)?;
    let page_id = ObjectId::new();
    let crawled_at = DateTime::now();
    let expires_at = DateTime::from_millis(crawled_at.timestamp_millis() + 7 * 24 * 3600 * 1000);
    let classification = serde_json::json!({
        "pageType": classify_page(&fetched.task.current_url, metadata.get("title").and_then(|value| value.as_str()).unwrap_or("")),
        "confidence": 0.75,
    });
    let score = score_page(&metadata, &emails, &social, word_count);
    let page_doc = doc! {
        "_id": page_id,
        "deviceId": device_id,
        "workspaceId": device_id,
        "crawlId": crawl_id,
        "url": &fetched.task.current_url,
        "domain": &fetched.domain,
        "depth": fetched.task.depth,
        "parentUrl": fetched.task.parent_url.clone(),
        "parentPageId": fetched.task.parent_page_id,
        "metadata": to_bson(&metadata)?,
        "links": &links[..std::cmp::min(links.len(), 100)],
        "emails": &emails,
        "social": to_bson(&social)?,
        "techStack": to_bson(&tech_stack)?,
        "classification": to_bson(&classification)?,
        "score": score,
        "status": "crawled",
        "searchText": build_search_text(&fetched.task.current_url, &fetched.domain, &metadata, &emails, &links, &social, &body_text),
        "crawledAt": crawled_at,
        "contentHash": simple_hash(&fetched.html_content),
        "expiresAt": expires_at,
        "content": Bson::Null,
        "compressionAlgorithm": "zstd",
        "compressedContent": Binary {
            subtype: mongodb::bson::spec::BinarySubtype::Generic,
            bytes: compressed_bytes,
        }
    };

    let mut set_doc = page_doc.clone();
    set_doc.remove("_id");
    page_col.update_one(
        doc! { "deviceId": device_id, "crawlId": crawl_id, "url": &fetched.task.current_url },
        doc! { "$set": set_doc, "$setOnInsert": { "_id": page_id } },
        UpdateOptions::builder().upsert(true).build(),
    ).await?;

    let content_hash = simple_hash(&fetched.html_content);
    let page_event = serde_json::json!({
        "_id": page_id.to_hex(),
        "deviceId": device_id,
        "workspaceId": device_id,
        "crawlId": crawl_id.to_hex(),
        "url": fetched.task.current_url,
        "domain": fetched.domain,
        "depth": fetched.task.depth,
        "parentUrl": fetched.task.parent_url,
        "parentPageId": fetched.task.parent_page_id.map(|id| id.to_hex()),
        "metadata": metadata,
        "links": links.iter().take(100).cloned().collect::<Vec<String>>(),
        "emails": emails,
        "social": social,
        "techStack": tech_stack,
        "classification": classification,
        "score": score,
        "status": "crawled",
        "crawledAt": crawled_at.try_to_rfc3339_string().unwrap_or_else(|_| crawled_at.timestamp_millis().to_string()),
        "contentHash": content_hash,
    });

    Ok(StoredPageOutcome {
        url: fetched.task.current_url,
        depth: fetched.task.depth,
        page_id,
        links,
        email_count: emails.len(),
        social_count: count_social_links(&social),
        page_event,
    })
}

async fn process_job(
    db: &mongodb::Database,
    crawl_id: ObjectId,
    device_id: &str,
    redis_client: &redis::Client,
) -> Result<(), Box<dyn std::error::Error>> {
    let job_col = db.collection::<CrawlJob>("crawljobs");
    let page_col = db.collection::<mongodb::bson::Document>("pages");

    // Fetch the job
    let job = match job_col.find_one(doc! { "_id": crawl_id, "deviceId": device_id }, None).await? {
        Some(j) => j,
        None => {
            warn!("Crawl job {} not found in database", crawl_id);
            return Ok(());
        }
    };

    info!("Starting crawl job for seed URL: {}", job.seed_url);

    // Update job status to running
    job_col.update_one(
        doc! { "_id": crawl_id },
        doc! { "$set": { "status": "running", "startedAt": DateTime::now() } },
        None,
    ).await?;
    publish_crawl_update(redis_client, device_id, crawl_id, serde_json::json!({ "status": "running" })).await.ok();

    let email_regex = Regex::new(r"(?i)\b[A-Z0-9._%+-]{1,64}@[A-Z0-9.-]+\.[A-Z]{2,24}\b")?;
    let mut visited = HashSet::new();
    let mut queue = VecDeque::new();
    queue.push_back((job.seed_url.clone(), 0, Option::<String>::None, Option::<ObjectId>::None));

    let mut successful_pages = 0;
    let mut emails_found_count = 0;
    let mut social_links_found_count = 0;

    let seed_parsed = Url::parse(&job.seed_url)?;
    let seed_domain = seed_parsed.domain().unwrap_or("").to_string();
    let mut request_index = 0usize;

    let concurrency = job.config.concurrency.clamp(1, 32) as usize;
    while !queue.is_empty() && successful_pages < job.config.max_pages {
        if let Some(latest_job) = job_col.find_one(doc! { "_id": crawl_id }, None).await? {
            if latest_job.requested_stop {
                info!("Crawl job {} was requested to stop", crawl_id);
                job_col.update_one(
                    doc! { "_id": crawl_id },
                    doc! { "$set": { "status": "stopped", "completedAt": DateTime::now() } },
                    None,
                ).await?;
                publish_crawl_update(redis_client, device_id, crawl_id, serde_json::json!({ "status": "stopped" })).await.ok();
                return Ok(());
            }
            if latest_job.requested_pause || latest_job.status == "paused" {
                info!("Crawl job {} is paused", crawl_id);
                job_col.update_one(
                    doc! { "_id": crawl_id },
                    doc! { "$set": { "status": "paused" } },
                    None,
                ).await?;
                publish_crawl_update(redis_client, device_id, crawl_id, serde_json::json!({ "status": "paused" })).await.ok();
                while let Some(paused_job) = job_col.find_one(doc! { "_id": crawl_id }, None).await? {
                    if paused_job.requested_stop {
                        job_col.update_one(
                            doc! { "_id": crawl_id },
                            doc! { "$set": { "status": "stopped", "completedAt": DateTime::now() } },
                            None,
                        ).await?;
                        publish_crawl_update(redis_client, device_id, crawl_id, serde_json::json!({ "status": "stopped" })).await.ok();
                        return Ok(());
                    }
                    if !paused_job.requested_pause && paused_job.status != "paused" {
                        job_col.update_one(
                            doc! { "_id": crawl_id },
                            doc! { "$set": { "status": "running" } },
                            None,
                        ).await?;
                        publish_crawl_update(redis_client, device_id, crawl_id, serde_json::json!({ "status": "running" })).await.ok();
                        break;
                    }
                    tokio::time::sleep(Duration::from_millis(500)).await;
                }
            }
        }

        let mut batch = Vec::new();
        while batch.len() < concurrency && successful_pages + (batch.len() as i32) < job.config.max_pages {
            let Some((current_url, depth, parent_url, parent_page_id)) = queue.pop_front() else { break; };
            if visited.contains(&current_url) {
                continue;
            }
            visited.insert(current_url.clone());
            batch.push(PageTask { current_url, depth, parent_url, parent_page_id, request_index });
            request_index += 1;
        }
        if batch.is_empty() {
            continue;
        }

        let mut join_set = tokio::task::JoinSet::new();
        for task in batch {
            let seed_domain = seed_domain.clone();
            let config = job.config.clone();
            join_set.spawn(async move {
                fetch_page_for_task(task, seed_domain, config).await
            });
        }

        while let Some(result) = join_set.join_next().await {
            match result {
                Ok(Ok(fetched)) => {
                    let outcome = store_fetched_page(&page_col, device_id, crawl_id, &job.config, &email_regex, fetched).await?;
                    successful_pages += 1;
                    emails_found_count += outcome.email_count as i32;
                    social_links_found_count += outcome.social_count as i32;
                    job_col.update_one(
                        doc! { "_id": crawl_id },
                        doc! {
                            "$set": {
                                "pagesCrawled": successful_pages,
                                "emailsFound": emails_found_count,
                                "socialLinksFound": social_links_found_count,
                            }
                        },
                        None,
                    ).await?;
                    publish_crawl_page(
                        redis_client,
                        device_id,
                        crawl_id,
                        outcome.page_event.clone(),
                        serde_json::json!({
                            "status": "running",
                            "pagesCrawled": successful_pages,
                            "emailsFound": emails_found_count,
                            "socialLinksFound": social_links_found_count,
                        }),
                    ).await.ok();
                    if job.config.extract.links && outcome.depth < job.config.max_depth {
                        for link in outcome.links {
                            if !visited.contains(&link) {
                                queue.push_back((link, outcome.depth + 1, Some(outcome.url.clone()), Some(outcome.page_id)));
                            }
                        }
                    }
                }
                Ok(Err(failure)) => {
                    warn!("Failed to fetch URL {}: {}", failure.task.current_url, failure.message);
                    let _ = upsert_failed_page(
                        &page_col,
                        device_id,
                        crawl_id,
                        &failure.task.current_url,
                        &failure.domain,
                        failure.task.depth,
                        failure.task.parent_url,
                        failure.task.parent_page_id,
                        &failure.message,
                    ).await;
                }
                Err(error) => warn!("Crawl page task failed to join: {}", error),
            }
        }
    }

    if successful_pages == 0 {
        job_col.update_one(
            doc! { "_id": crawl_id },
            doc! { "$set": { "status": "failed", "error": "No pages crawled successfully", "deadLetterReason": "No pages crawled successfully", "completedAt": DateTime::now() } },
            None,
        ).await?;
        publish_crawl_update(
            redis_client,
            device_id,
            crawl_id,
            serde_json::json!({ "status": "failed", "error": "No pages crawled successfully" }),
        ).await.ok();
    } else {
        job_col.update_one(
            doc! { "_id": crawl_id },
            doc! { "$set": { "status": "completed", "completedAt": DateTime::now() } },
            None,
        ).await?;
        publish_crawl_update(
            redis_client,
            device_id,
            crawl_id,
            serde_json::json!({
                "status": "completed",
                "pagesCrawled": successful_pages,
                "emailsFound": emails_found_count,
                "socialLinksFound": social_links_found_count,
            }),
        ).await.ok();
    }

    info!("Completed crawl job {}", crawl_id);
    Ok(())
}

async fn publish_crawl_page(
    redis_client: &redis::Client,
    device_id: &str,
    crawl_id: ObjectId,
    page: serde_json::Value,
    job: serde_json::Value,
) -> redis::RedisResult<()> {
    publish_live_event(redis_client, serde_json::json!({
        "type": "crawl.page",
        "deviceId": device_id,
        "crawlId": crawl_id.to_hex(),
        "data": {
            "page": page,
            "job": job,
        },
    })).await
}

async fn publish_crawl_update(
    redis_client: &redis::Client,
    device_id: &str,
    crawl_id: ObjectId,
    job: serde_json::Value,
) -> redis::RedisResult<()> {
    publish_live_event(redis_client, serde_json::json!({
        "type": "crawl.updated",
        "deviceId": device_id,
        "crawlId": crawl_id.to_hex(),
        "data": {
            "job": job,
        },
    })).await
}

async fn publish_live_event(redis_client: &redis::Client, mut event: serde_json::Value) -> redis::RedisResult<()> {
    event["at"] = serde_json::Value::String(DateTime::now().try_to_rfc3339_string().unwrap_or_else(|_| DateTime::now().timestamp_millis().to_string()));
    let mut con = redis_client.get_async_connection().await?;
    let _: i32 = con.publish(LIVE_EVENTS_CHANNEL, event.to_string()).await?;
    Ok(())
}

fn simple_hash(content: &str) -> String {
    let mut hasher = std::collections::hash_map::DefaultHasher::new();
    content.hash(&mut hasher);
    format!("{:016x}", hasher.finish())
}

fn build_request_client(index: usize) -> Result<reqwest::Client, reqwest::Error> {
    let identity = request_identity(index);
    let mut builder = reqwest::Client::builder()
        .timeout(Duration::from_secs(15))
        .redirect(reqwest::redirect::Policy::limited(5))
        .user_agent(identity.user_agent);

    if let Some(proxy_url) = identity.proxy_url {
        if let Ok(proxy) = reqwest::Proxy::all(&proxy_url) {
            builder = builder.proxy(proxy);
        }
    }

    builder.build()
}

struct RequestIdentity {
    user_agent: String,
    proxy_url: Option<String>,
}

fn request_identity(index: usize) -> RequestIdentity {
    let user_agents = configured_user_agents();
    let proxies = env_list("CRAWLER_PROXY_URLS");
    RequestIdentity {
        user_agent: user_agents[index % user_agents.len()].clone(),
        proxy_url: if proxies.is_empty() { None } else { Some(proxies[index % proxies.len()].clone()) },
    }
}

fn configured_user_agents() -> Vec<String> {
    let mut values = Vec::new();
    if let Ok(value) = env::var("CRAWLER_USER_AGENT") {
        values.extend(split_env_list(&value));
    }
    if let Ok(value) = env::var("CRAWLER_USER_AGENT_POOL") {
        values.extend(split_env_list(&value));
    }
    values.sort();
    values.dedup();
    if values.is_empty() {
        values.push(default_device_user_agent());
    }
    values
}

fn env_list(name: &str) -> Vec<String> {
    env::var(name).map(|value| split_env_list(&value)).unwrap_or_default()
}

fn split_env_list(value: &str) -> Vec<String> {
    value
        .split(|ch| ch == ',' || ch == '|' || ch == '\n')
        .map(str::trim)
        .filter(|item| !item.is_empty())
        .map(String::from)
        .collect()
}

fn default_device_user_agent() -> String {
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36".to_string()
}

fn env_number(name: &str, fallback: usize) -> usize {
    env::var(name)
        .ok()
        .and_then(|value| value.parse::<usize>().ok())
        .filter(|value| *value > 0)
        .unwrap_or(fallback)
}

fn searchable_email_text(html: &str, document: &Html) -> String {
    let mut parts = vec![decode_text_variants(html)];
    for selector in ["a[href]", "[href]", "[title]", "[aria-label]", "[data-email]", "[content]"] {
        if let Ok(parsed) = Selector::parse(selector) {
            for element in document.select(&parsed) {
                for attribute in ["href", "title", "aria-label", "data-email", "content"] {
                    if let Some(value) = element.value().attr(attribute) {
                        parts.push(decode_text_variants(value));
                    }
                }
            }
        }
    }
    decode_text_variants(&parts.join(" "))
}

fn decode_text_variants(value: &str) -> String {
    value
        .replace("\\u0040", "@")
        .replace("\\x40", "@")
        .replace("&#64;", "@")
        .replace("&commat;", "@")
        .replace("&period;", ".")
        .replace("&dot;", ".")
        .replace("[at]", "@")
        .replace("(at)", "@")
        .replace(" at ", "@")
        .replace("[dot]", ".")
        .replace("(dot)", ".")
        .replace(" dot ", ".")
        .replace("&amp;", "&")
}

fn is_useful_email(email: &str) -> bool {
    let (local, domain) = match email.split_once('@') {
        Some(parts) => parts,
        None => return false,
    };
    if local.is_empty() || domain.is_empty() || local.len() > 64 || domain.len() > 253 {
        return false;
    }
    if local.starts_with('.') || local.ends_with('.') || local.contains("..") || domain.contains("..") {
        return false;
    }
    if domain == "sentry.io" || domain.ends_with(".sentry.io") || domain.ends_with(".ingest.sentry.io") {
        return false;
    }
    let labels: Vec<&str> = domain.split('.').collect();
    if labels.len() < 2 || labels.iter().any(|label| label.is_empty() || label.starts_with('-') || label.ends_with('-')) {
        return false;
    }
    let non_email_tlds = ["avif", "css", "gif", "jpeg", "jpg", "js", "json", "map", "png", "svg", "webp", "woff", "woff2"];
    !labels.last().is_some_and(|tld| non_email_tlds.contains(tld))
}

fn empty_social() -> serde_json::Value {
    serde_json::json!({
        "twitter": Vec::<String>::new(),
        "linkedin": Vec::<String>::new(),
        "instagram": Vec::<String>::new(),
        "facebook": Vec::<String>::new(),
        "github": Vec::<String>::new(),
        "youtube": Vec::<String>::new(),
        "tiktok": Vec::<String>::new(),
        "reddit": Vec::<String>::new(),
        "pinterest": Vec::<String>::new(),
        "snapchat": Vec::<String>::new(),
        "telegram": Vec::<String>::new(),
        "whatsapp": Vec::<String>::new(),
        "discord": Vec::<String>::new(),
        "medium": Vec::<String>::new(),
        "devto": Vec::<String>::new(),
        "behance": Vec::<String>::new(),
        "dribbble": Vec::<String>::new(),
        "stackoverflow": Vec::<String>::new(),
        "gitlab": Vec::<String>::new(),
        "bitbucket": Vec::<String>::new(),
        "threads": Vec::<String>::new(),
        "mastodon": Vec::<String>::new(),
        "bluesky": Vec::<String>::new(),
        "twitch": Vec::<String>::new(),
        "vimeo": Vec::<String>::new(),
        "substack": Vec::<String>::new(),
        "quora": Vec::<String>::new(),
        "wechat": Vec::<String>::new(),
        "weibo": Vec::<String>::new(),
        "line": Vec::<String>::new(),
        "kakaotalk": Vec::<String>::new(),
        "patreon": Vec::<String>::new(),
        "buymeacoffee": Vec::<String>::new(),
        "linktree": Vec::<String>::new(),
        "calendly": Vec::<String>::new(),
    })
}

fn extract_metadata(document: &Html, url: &Url) -> serde_json::Value {
    let title = text_for_selector(document, "title");
    let description = meta_content(document, "description");
    let canonical = attr_for_selector(document, "link[rel='canonical']", "href")
        .and_then(|href| url.join(&href).ok().map(|next| next.to_string()));
    let language = attr_for_selector(document, "html", "lang");
    let robots = meta_content(document, "robots");
    let generator = meta_content(document, "generator");
    let og_title = meta_property(document, "og:title");
    let og_description = meta_property(document, "og:description");
    let og_image = meta_property(document, "og:image")
        .and_then(|href| url.join(&href).ok().map(|next| next.to_string()));
    let twitter_title = meta_name_or_property(document, "twitter:title");
    let twitter_description = meta_name_or_property(document, "twitter:description");
    serde_json::json!({
        "title": title,
        "description": description,
        "canonical": canonical,
        "language": language,
        "robots": robots,
        "generator": generator,
        "ogTitle": og_title,
        "ogDescription": og_description,
        "ogImage": og_image,
        "twitterTitle": twitter_title,
        "twitterDescription": twitter_description,
    })
}

fn extract_content(document: &Html) -> (String, Vec<String>, Vec<String>, i32) {
    let p_selector = Selector::parse("p").unwrap();
    let paragraphs: Vec<String> = document
        .select(&p_selector)
        .map(|e| e.text().collect::<Vec<_>>().join(" ").trim().to_string())
        .filter(|s| !s.is_empty())
        .take(30)
        .collect();

    let h_selector = Selector::parse("h1, h2, h3").unwrap();
    let headings: Vec<String> = document
        .select(&h_selector)
        .map(|e| e.text().collect::<Vec<_>>().join(" ").trim().to_string())
        .filter(|s| !s.is_empty())
        .take(30)
        .collect();

    let body_text = paragraphs.join(" ");
    let word_count = body_text.split_whitespace().count() as i32;
    (body_text, headings, paragraphs, word_count)
}

fn detect_tech_stack(
    document: &Html,
    html: &str,
    headers: &reqwest::header::HeaderMap,
    metadata: &serde_json::Value,
) -> Vec<String> {
    let lower = html.to_ascii_lowercase();
    let mut tech = Vec::<String>::new();
    let header_text = headers.iter()
        .filter_map(|(key, value)| value.to_str().ok().map(|value| format!("{}:{}", key.as_str(), value)))
        .collect::<Vec<_>>()
        .join("\n")
        .to_ascii_lowercase();
    let generator = metadata.get("generator").and_then(|value| value.as_str()).unwrap_or("").to_ascii_lowercase();

    push_if(&mut tech, "WordPress", generator.contains("wordpress") || lower.contains("wp-content/") || lower.contains("wp-includes/"));
    push_if(&mut tech, "Shopify", lower.contains("shopify.theme") || lower.contains("cdn.shopify.com") || lower.contains("shopifyanalytics"));
    push_if(&mut tech, "Next.js", lower.contains("/_next/static/") || lower.contains("__next_data__"));
    push_if(&mut tech, "Nuxt", lower.contains("__nuxt__") || lower.contains("/_nuxt/"));
    push_if(&mut tech, "React", lower.contains("data-reactroot") || lower.contains("react-dom") || lower.contains("__react"));
    push_if(&mut tech, "Vue", lower.contains("data-v-") || lower.contains("__vue__") || lower.contains("vue.runtime"));
    push_if(&mut tech, "Angular", lower.contains("ng-version") || lower.contains("ng-app") || lower.contains("angular.js"));
    push_if(&mut tech, "Svelte", lower.contains("svelte-"));
    push_if(&mut tech, "Astro", generator.contains("astro") || lower.contains("astro-island"));
    push_if(&mut tech, "Gatsby", lower.contains("gatsby") || lower.contains("___gatsby"));
    push_if(&mut tech, "Webflow", lower.contains("webflow.js") || lower.contains("data-wf-page"));
    push_if(&mut tech, "Wix", lower.contains("wixstatic.com") || lower.contains("x-wix-"));
    push_if(&mut tech, "Squarespace", lower.contains("squarespace.com") || lower.contains("static1.squarespace.com"));
    push_if(&mut tech, "Cloudflare", header_text.contains("cf-ray") || header_text.contains("server:cloudflare"));
    push_if(&mut tech, "Vercel", header_text.contains("x-vercel") || header_text.contains("server:vercel"));
    push_if(&mut tech, "Netlify", header_text.contains("x-nf-request-id") || header_text.contains("server:netlify"));
    push_if(&mut tech, "Google Tag Manager", lower.contains("googletagmanager.com/gtm.js") || lower.contains("gtm-"));
    push_if(&mut tech, "Google Analytics", lower.contains("google-analytics.com") || lower.contains("gtag("));
    push_if(&mut tech, "HubSpot", lower.contains("js.hs-scripts.com") || lower.contains("hubspot"));
    push_if(&mut tech, "Intercom", lower.contains("widget.intercom.io") || lower.contains("intercomsettings"));
    push_if(&mut tech, "Stripe", lower.contains("js.stripe.com"));
    push_if(&mut tech, "Calendly", lower.contains("assets.calendly.com"));

    if let Ok(selector) = Selector::parse("script[src], link[href]") {
        for element in document.select(&selector) {
            let value = element.value().attr("src").or_else(|| element.value().attr("href")).unwrap_or("").to_ascii_lowercase();
            push_if(&mut tech, "Bootstrap", value.contains("bootstrap"));
            push_if(&mut tech, "Tailwind CSS", value.contains("tailwind"));
            push_if(&mut tech, "jQuery", value.contains("jquery"));
        }
    }

    tech.sort();
    tech.dedup();
    tech
}

fn push_if(values: &mut Vec<String>, label: &str, condition: bool) {
    if condition && !values.iter().any(|value| value == label) {
        values.push(label.to_string());
    }
}

fn text_for_selector(document: &Html, selector: &str) -> Option<String> {
    let selector = Selector::parse(selector).ok()?;
    document.select(&selector).next().map(|node| node.text().collect::<Vec<_>>().join(" ").trim().to_string()).filter(|value| !value.is_empty())
}

fn attr_for_selector(document: &Html, selector: &str, attr: &str) -> Option<String> {
    let selector = Selector::parse(selector).ok()?;
    document.select(&selector).next()?.value().attr(attr).map(|value| value.trim().to_string()).filter(|value| !value.is_empty())
}

fn meta_content(document: &Html, name: &str) -> Option<String> {
    attr_for_selector(document, &format!("meta[name='{}']", name), "content")
}

fn meta_property(document: &Html, property: &str) -> Option<String> {
    attr_for_selector(document, &format!("meta[property='{}']", property), "content")
}

fn meta_name_or_property(document: &Html, key: &str) -> Option<String> {
    meta_content(document, key).or_else(|| meta_property(document, key))
}

fn is_likely_page_url(url: &Url) -> bool {
    if url.scheme() != "http" && url.scheme() != "https" {
        return false;
    }
    let path = url.path().to_ascii_lowercase();
    let blocked_extensions = [
        ".jpg", ".jpeg", ".png", ".gif", ".webp", ".svg", ".ico", ".css", ".js", ".mjs",
        ".pdf", ".zip", ".gz", ".mp4", ".mp3", ".mov", ".avi", ".webm", ".woff", ".woff2",
    ];
    !blocked_extensions.iter().any(|ext| path.ends_with(ext))
}

async fn is_allowed_by_robots(client: &reqwest::Client, url: &Url, respect_robots: bool) -> bool {
    if !respect_robots {
        return true;
    }
    let robots_url = match url.join("/robots.txt") {
        Ok(value) => value,
        Err(_) => return true,
    };
    let body = match client.get(robots_url).send().await {
        Ok(response) if response.status().is_success() => response.text().await.unwrap_or_default(),
        _ => return true,
    };
    let path = url.path();
    let mut applies = false;
    let mut allowed = true;
    for raw_line in body.lines() {
        let line = raw_line.split('#').next().unwrap_or("").trim();
        if line.is_empty() {
            applies = false;
            continue;
        }
        let Some((key, value)) = line.split_once(':') else {
            continue;
        };
        let key = key.trim().to_ascii_lowercase();
        let value = value.trim();
        if key == "user-agent" {
            applies = value == "*" || value.to_ascii_lowercase().contains("webintelligencecrawler");
            continue;
        }
        if applies && key == "allow" && !value.is_empty() && robots_path_matches(path, value) {
            allowed = true;
        }
        if applies && key == "disallow" && !value.is_empty() && robots_path_matches(path, value) {
            allowed = false;
        }
    }
    allowed
}

fn robots_path_matches(path: &str, rule: &str) -> bool {
    if rule == "/" {
        return true;
    }
    let rule = rule.trim_end_matches('*');
    path.starts_with(rule)
}

fn social_platform(url: &Url) -> Option<&'static str> {
    let host = url.host_str()?.trim_start_matches("www.").to_ascii_lowercase();
    let path = url.path().trim_matches('/').to_ascii_lowercase();
    let parts: Vec<&str> = path.split('/').filter(|part| !part.is_empty()).collect();
    let first = parts.first().copied().unwrap_or("");

    if (host == "twitter.com" || host == "x.com") && !["share", "intent", "home", "search", "hashtag", "i"].contains(&first) && !parts.is_empty() {
        return Some("twitter");
    }
    if host.ends_with("linkedin.com") && ["in", "company", "school", "showcase"].contains(&first) && parts.len() >= 2 {
        return Some("linkedin");
    }
    if host.ends_with("facebook.com") && !["share", "sharer", "plugins", "dialog"].contains(&first) && !parts.is_empty() {
        return Some("facebook");
    }
    if host.ends_with("instagram.com") && !parts.is_empty() {
        return Some("instagram");
    }
    if (host == "youtu.be" && !parts.is_empty()) || (host.ends_with("youtube.com") && (first.starts_with('@') || ["channel", "c", "user"].contains(&first))) {
        return Some("youtube");
    }
    if host == "github.com" && !["topics", "explore", "features", "marketplace", "collections", "pricing"].contains(&first) && !parts.is_empty() {
        return Some("github");
    }
    if host == "gitlab.com" && !["explore", "help", "users", "dashboard"].contains(&first) && !parts.is_empty() {
        return Some("gitlab");
    }
    if host == "tiktok.com" && !parts.is_empty() {
        return Some("tiktok");
    }
    if host.ends_with("reddit.com") && ["r", "user", "u"].contains(&first) && parts.len() >= 2 {
        return Some("reddit");
    }
    if host.ends_with("pinterest.com") && !["pin", "search", "ideas"].contains(&first) && !parts.is_empty() {
        return Some("pinterest");
    }
    if host == "t.me" || host == "telegram.me" || host == "telegram.org" {
        return Some("telegram");
    }
    if host == "wa.me" || host.ends_with("whatsapp.com") {
        return Some("whatsapp");
    }
    if host == "discord.gg" || host.ends_with("discord.com") {
        return Some("discord");
    }
    if host.ends_with("medium.com") && first.starts_with('@') {
        return Some("medium");
    }
    if host == "dev.to" && parts.len() == 1 {
        return Some("devto");
    }
    if host == "behance.net" && !parts.is_empty() {
        return Some("behance");
    }
    if host == "dribbble.com" && !parts.is_empty() {
        return Some("dribbble");
    }
    if host.ends_with("stackoverflow.com") && first == "users" && parts.len() >= 2 {
        return Some("stackoverflow");
    }
    if host == "bitbucket.org" && !parts.is_empty() {
        return Some("bitbucket");
    }
    if host == "threads.net" && !parts.is_empty() {
        return Some("threads");
    }
    if parts.iter().any(|part| part.starts_with('@')) || first == "users" {
        if host.contains("mastodon") {
            return Some("mastodon");
        }
    }
    if host == "bsky.app" && first == "profile" && parts.len() >= 2 {
        return Some("bluesky");
    }
    if host == "twitch.tv" && !parts.is_empty() {
        return Some("twitch");
    }
    if host == "vimeo.com" && !parts.is_empty() {
        return Some("vimeo");
    }
    if host.ends_with("substack.com") {
        return Some("substack");
    }
    if host.ends_with("quora.com") && first == "profile" && parts.len() >= 2 {
        return Some("quora");
    }
    if host.contains("wechat.com") {
        return Some("wechat");
    }
    if host.contains("weibo.com") {
        return Some("weibo");
    }
    if host == "line.me" {
        return Some("line");
    }
    if host.contains("kakao.com") {
        return Some("kakaotalk");
    }
    if host == "patreon.com" && !parts.is_empty() {
        return Some("patreon");
    }
    if host == "buymeacoffee.com" && !parts.is_empty() {
        return Some("buymeacoffee");
    }
    if host == "linktr.ee" && !parts.is_empty() {
        return Some("linktree");
    }
    if host == "calendly.com" && !parts.is_empty() {
        return Some("calendly");
    }
    None
}

fn canonical_social_url(mut url: Url, platform: &str) -> String {
    url.set_fragment(None);
    url.set_query(None);
    let host = url.host_str().unwrap_or("").trim_start_matches("www.").to_ascii_lowercase();
    let canonical_host = if platform == "twitter" && host == "x.com" { "twitter.com" } else { &host };
    let _ = url.set_host(Some(canonical_host));
    let _ = url.set_scheme("https");
    while url.path().ends_with('/') && url.path() != "/" {
        let trimmed = url.path().trim_end_matches('/').to_string();
        url.set_path(&trimmed);
    }
    url.to_string()
}

fn classify_page(url: &str, title: &str) -> &'static str {
    let text = format!("{} {}", url, title).to_ascii_lowercase();
    if text.contains("contact") {
        "contact"
    } else if text.contains("about") {
        "about"
    } else if text.contains("pricing") {
        "pricing"
    } else if text.contains("blog") || text.contains("news") {
        "article"
    } else if text.contains("career") || text.contains("jobs") {
        "careers"
    } else {
        "general"
    }
}

fn score_page(metadata: &serde_json::Value, emails: &[String], social: &serde_json::Value, word_count: i32) -> f64 {
    let mut score: f64 = 0.2;
    if metadata.get("title").and_then(|value| value.as_str()).filter(|value| !value.is_empty()).is_some() {
        score += 0.15;
    }
    if metadata.get("description").and_then(|value| value.as_str()).filter(|value| !value.is_empty()).is_some() {
        score += 0.15;
    }
    if !emails.is_empty() {
        score += 0.2;
    }
    if count_social_links(social) > 0 {
        score += 0.15;
    }
    if word_count >= 100 {
        score += 0.15;
    }
    score.min(1.0)
}

fn count_social_links(social: &serde_json::Value) -> usize {
    social.as_object()
        .map(|items| items.values().filter_map(|value| value.as_array()).map(|items| items.len()).sum())
        .unwrap_or(0)
}

fn build_search_text(
    url: &str,
    domain: &str,
    metadata: &serde_json::Value,
    emails: &[String],
    links: &[String],
    social: &serde_json::Value,
    content_text: &str,
) -> String {
    let mut parts = vec![url.to_string(), domain.to_string()];
    if let Some(values) = metadata.as_object() {
        for value in values.values() {
            if let Some(text) = value.as_str() {
                if !text.is_empty() {
                    parts.push(text.to_string());
                }
            }
        }
    }
    parts.extend(emails.iter().cloned());
    parts.extend(links.iter().take(50).cloned());
    if let Some(values) = social.as_object() {
        for value in values.values() {
            if let Some(items) = value.as_array() {
                parts.extend(items.iter().filter_map(|item| item.as_str().map(String::from)));
            }
        }
    }
    parts.push(content_text.to_string());
    parts.join(" ").chars().take(50_000).collect()
}

async fn upsert_failed_page(
    page_col: &mongodb::Collection<mongodb::bson::Document>,
    device_id: &str,
    crawl_id: ObjectId,
    current_url: &str,
    domain: &str,
    depth: i32,
    parent_url: Option<String>,
    parent_page_id: Option<ObjectId>,
    message: &str,
) -> Result<(), mongodb::error::Error> {
    let page_id = ObjectId::new();
    page_col.update_one(
        doc! { "deviceId": device_id, "crawlId": crawl_id, "url": current_url },
        doc! {
            "$set": {
                "deviceId": device_id,
                "workspaceId": device_id,
                "crawlId": crawl_id,
                "url": current_url,
                "domain": domain,
                "depth": depth,
                "parentUrl": parent_url,
                "parentPageId": parent_page_id,
                "discoveredFrom": Bson::Null,
                "metadata": { "title": format!("Fetch failed: {}", message) },
                "links": Vec::<String>::new(),
                "emails": Vec::<String>::new(),
                "social": to_bson(&empty_social()).unwrap_or(Bson::Null),
                "techStack": Vec::<String>::new(),
                "content": { "text": "", "headings": Vec::<String>::new(), "paragraphs": Vec::<String>::new(), "wordCount": 0 },
                "classification": { "pageType": "failed", "confidence": 1.0 },
                "score": 0.0,
                "status": "failed",
                "searchText": format!("{} {} fetch failed {}", current_url, domain, message),
                "crawledAt": DateTime::now(),
                "contentHash": format!("error:{}", simple_hash(message)),
                "expiresAt": DateTime::from_millis(DateTime::now().timestamp_millis() + 7 * 24 * 3600 * 1000),
            },
            "$setOnInsert": { "_id": page_id }
        },
        UpdateOptions::builder().upsert(true).build(),
    ).await?;
    Ok(())
}
