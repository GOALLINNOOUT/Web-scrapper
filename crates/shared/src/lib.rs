use serde::{Deserialize, Serialize};
use std::env;
use std::io::Write;
use mongodb::{Client, options::ClientOptions};
use redis::Client as RedisClient;

// Load environments
pub fn init_env() {
    dotenvy::dotenv().ok();
}

// Zstd compression helpers
pub fn compress_data(data: &[u8]) -> Result<Vec<u8>, std::io::Error> {
    let mut encoder = zstd::Encoder::new(Vec::new(), 3)?;
    encoder.write_all(data)?;
    encoder.finish()
}

pub fn decompress_data(data: &[u8]) -> Result<Vec<u8>, std::io::Error> {
    zstd::decode_all(data)
}

// Database Connection Helpers
pub async fn get_mongo_client() -> Result<Client, mongodb::error::Error> {
    let mongo_uri = env::var("MONGODB_URI").unwrap_or_else(|_| "mongodb://127.0.0.1:27017/web_intelligence".to_string());
    let client_options = ClientOptions::parse(mongo_uri).await?;
    Client::with_options(client_options)
}

pub fn get_redis_client() -> Result<RedisClient, redis::RedisError> {
    let redis_url = env::var("REDIS_URL").unwrap_or_else(|_| "redis://127.0.0.1:6379".to_string());
    RedisClient::open(redis_url)
}

// Models
#[derive(Debug, Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct CrawlConfig {
    pub seed_url: String,
    pub max_pages: i32,
    pub max_depth: i32,
    #[serde(default = "default_concurrency")]
    pub concurrency: i32,
    #[serde(default = "default_true")]
    pub same_domain_only: bool,
    #[serde(default = "default_false")]
    pub respect_robots: bool,
    #[serde(default)]
    pub extract: ExtractConfig,
    #[serde(default)]
    pub discovery: DiscoveryConfig,
}

fn default_concurrency() -> i32 { 4 }
fn default_true() -> bool { true }

#[derive(Debug, Serialize, Deserialize, Clone, Default)]
#[serde(rename_all = "camelCase")]
pub struct ExtractConfig {
    #[serde(default = "default_true")]
    pub links: bool,
    #[serde(default = "default_true")]
    pub emails: bool,
    #[serde(default = "default_true")]
    pub social: bool,
    #[serde(default = "default_true")]
    pub metadata: bool,
    #[serde(default = "default_true")]
    pub content: bool,
}

#[derive(Debug, Serialize, Deserialize, Clone, Default)]
#[serde(rename_all = "camelCase")]
pub struct DiscoveryConfig {
    #[serde(default = "default_true")]
    pub sitemap: bool,
    #[serde(default = "default_false")]
    pub render_java_script: bool,
    #[serde(default = "default_render_below")]
    pub render_when_static_links_below: i32,
    #[serde(default = "default_false")]
    pub include_meta_links: bool,
}

fn default_false() -> bool { false }
fn default_render_below() -> i32 { 10 }

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct CrawlJob {
    #[serde(rename = "_id")]
    pub id: mongodb::bson::oid::ObjectId,
    #[serde(rename = "deviceId")]
    pub device_id: String,
    #[serde(rename = "seedUrl")]
    pub seed_url: String,
    pub status: String,
    pub config: CrawlConfig,
    #[serde(rename = "pagesCrawled", default)]
    pub pages_crawled: i32,
    #[serde(rename = "emailsFound", default)]
    pub emails_found: i32,
    #[serde(rename = "socialLinksFound", default)]
    pub social_links_found: i32,
    #[serde(rename = "requestedStop", default)]
    pub requested_stop: bool,
    #[serde(rename = "requestedPause", default)]
    pub requested_pause: bool,
    pub error: Option<String>,
    #[serde(rename = "createdAt")]
    pub created_at: mongodb::bson::DateTime,
    #[serde(rename = "completedAt")]
    pub completed_at: Option<mongodb::bson::DateTime>,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct PageContent {
    pub text: String,
    pub headings: Vec<String>,
    pub paragraphs: Vec<String>,
    #[serde(rename = "wordCount")]
    pub word_count: i32,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct PageClassification {
    #[serde(rename = "pageType")]
    pub page_type: String,
    pub confidence: f64,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct Page {
    #[serde(rename = "deviceId")]
    pub device_id: String,
    #[serde(rename = "workspaceId")]
    pub workspace_id: String,
    #[serde(rename = "crawlId")]
    pub crawl_id: mongodb::bson::oid::ObjectId,
    pub url: String,
    pub domain: String,
    pub depth: i32,
    #[serde(rename = "parentUrl")]
    pub parent_url: Option<String>,
    #[serde(rename = "parentPageId")]
    pub parent_page_id: Option<mongodb::bson::oid::ObjectId>,
    pub metadata: serde_json::Value,
    pub links: Vec<String>,
    pub emails: Vec<String>,
    pub social: serde_json::Value,
    #[serde(rename = "techStack")]
    pub tech_stack: Vec<String>,
    pub classification: PageClassification,
    pub score: f64,
    pub status: String,
    #[serde(rename = "searchText")]
    pub search_text: String,
    #[serde(rename = "crawledAt")]
    pub crawled_at: mongodb::bson::DateTime,
    #[serde(rename = "contentHash")]
    pub content_hash: String,
    #[serde(rename = "expiresAt")]
    pub expires_at: mongodb::bson::DateTime,
    
    // Compression fields
    #[serde(rename = "compressionAlgorithm")]
    pub compression_algorithm: Option<String>,
    #[serde(rename = "compressedContent")]
    pub compressed_content: Option<mongodb::bson::Binary>,
}

// Queue messaging models
#[derive(Debug, Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct QueueJob {
    pub crawl_id: String,
    pub device_id: String,
}
