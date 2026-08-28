use hyper::service::{make_service_fn, service_fn};
use hyper::{header, upgrade, Body, Client, Request, Response, Server, StatusCode};
use std::convert::Infallible;
use std::env;
use std::net::SocketAddr;
use std::sync::atomic::{AtomicUsize, Ordering};
use std::sync::Arc;
use std::time::Duration;
use tokio::io::copy_bidirectional;
use tokio::sync::RwLock;
use tracing::{error, info, warn};

struct Backend {
    url: String,
    healthy: bool,
}

struct LoadBalancer {
    backends: Arc<RwLock<Vec<Backend>>>,
    index: AtomicUsize,
    client: Client<hyper::client::HttpConnector>,
}

impl LoadBalancer {
    fn new(backend_urls: Vec<String>) -> Self {
        let backends = backend_urls
            .into_iter()
            .map(|url| Backend { url, healthy: true })
            .collect();
        Self {
            backends: Arc::new(RwLock::new(backends)),
            index: AtomicUsize::new(0),
            client: Client::new(),
        }
    }

    async fn select_backend(&self) -> Option<String> {
        let backends = self.backends.read().await;
        let healthy_backends: Vec<&Backend> = backends.iter().filter(|b| b.healthy).collect();
        if healthy_backends.is_empty() {
            return None;
        }

        let idx = self.index.fetch_add(1, Ordering::Relaxed) % healthy_backends.len();
        Some(healthy_backends[idx].url.clone())
    }

    async fn mark_unhealthy(&self, url: &str) {
        let mut backends = self.backends.write().await;
        if let Some(b) = backends.iter_mut().find(|b| b.url == url) {
            if b.healthy {
                b.healthy = false;
                warn!("Backend marked UNHEALTHY: {}", url);
            }
        }
    }
}

#[tokio::main]
async fn main() {
    dotenvy::dotenv().ok();
    tracing_subscriber::fmt::init();

    let port = env::var("PORT")
        .unwrap_or_else(|_| "8080".to_string())
        .parse::<u16>()
        .unwrap_or(8080);

    let backends_str = env::var("BACKENDS")
        .unwrap_or_else(|_| "http://127.0.0.1:4000".to_string());
    
    let backend_urls: Vec<String> = backends_str
        .split(',')
        .map(|s| s.trim().to_string())
        .filter(|s| !s.is_empty())
        .collect();

    if backend_urls.is_empty() {
        error!("No backends configured. Set BACKENDS env variable.");
        std::process::exit(1);
    }

    info!("Load Balancer starting on port {} with backends: {:?}", port, backend_urls);

    let lb = Arc::new(LoadBalancer::new(backend_urls));

    // Health checker task
    let lb_clone = lb.clone();
    tokio::spawn(async move {
        let client = Client::new();
        loop {
            tokio::time::sleep(Duration::from_secs(5)).await;
            let mut backends = lb_clone.backends.write().await;
            for backend in backends.iter_mut() {
                let health_url = format!("{}/health", backend.url);
                let req_res = client.get(health_url.parse().unwrap()).await;
                let was_healthy = backend.healthy;
                backend.healthy = match req_res {
                    Ok(resp) => resp.status().is_success(),
                    Err(_) => false,
                };
                if was_healthy != backend.healthy {
                    if backend.healthy {
                        info!("Backend came back HEALTHY: {}", backend.url);
                    } else {
                        warn!("Backend health check FAILED: {}", backend.url);
                    }
                }
            }
        }
    });

    let addr = SocketAddr::from(([0, 0, 0, 0], port));

    let make_svc = make_service_fn(move |_conn| {
        let lb = lb.clone();
        async move {
            Ok::<_, Infallible>(service_fn(move |req: Request<Body>| {
                let lb = lb.clone();
                async move {
                    if is_websocket_upgrade(&req) {
                        return Ok::<Response<Body>, Infallible>(proxy_websocket(req, lb).await);
                    }

                    let method = req.method().clone();
                    let uri = req.uri().clone();
                    let headers = req.headers().clone();
                    let body_bytes = hyper::body::to_bytes(req.into_body()).await.unwrap_or_default();

                    let mut attempts = 0;
                    loop {
                        let backend_url = match lb.select_backend().await {
                            Some(url) => url,
                            None => {
                                error!("All backends are unhealthy or unavailable!");
                                let response = Response::builder()
                                    .status(StatusCode::SERVICE_UNAVAILABLE)
                                    .body(Body::from("Service Unavailable: No healthy backends"))
                                    .unwrap();
                                return Ok::<Response<Body>, Infallible>(response);
                            }
                        };

                        attempts += 1;
                        let uri_str = format!("{}{}", backend_url, uri.path_and_query().map(|pq| pq.as_str()).unwrap_or(""));

                        let mut proxy_req = Request::builder()
                            .method(method.clone())
                            .uri(&uri_str)
                            .body(Body::from(body_bytes.clone()))
                            .unwrap();

                        *proxy_req.headers_mut() = headers.clone();

                        info!("Proxying request to: {} (attempt {})", uri_str, attempts);

                        match lb.client.request(proxy_req).await {
                            Ok(res) => return Ok::<Response<Body>, Infallible>(res),
                            Err(err) => {
                                warn!("Failed to proxy to {} - Error: {}. Retrying next backend...", backend_url, err);
                                lb.mark_unhealthy(&backend_url).await;
                                if attempts >= 3 {
                                    error!("Max retry attempts reached. Request failed.");
                                    let response = Response::builder()
                                        .status(StatusCode::BAD_GATEWAY)
                                        .body(Body::from("Bad Gateway: All attempts failed"))
                                        .unwrap();
                                    return Ok::<Response<Body>, Infallible>(response);
                                }
                            }
                        }
                    }
                }
            }))
        }
    });

    let server = Server::bind(&addr).serve(make_svc);

    // Graceful shutdown
    let graceful = server.with_graceful_shutdown(async {
        match tokio::signal::ctrl_c().await {
            Ok(()) => info!("Shutting down load balancer gracefully..."),
            Err(error) => {
                warn!("CTRL+C handler unavailable; continuing without signal shutdown: {}", error);
                std::future::pending::<()>().await;
            }
        }
    });

    if let Err(e) = graceful.await {
        error!("server error: {}", e);
    }
}

fn is_websocket_upgrade(req: &Request<Body>) -> bool {
    let has_upgrade_connection = req
        .headers()
        .get(header::CONNECTION)
        .and_then(|value| value.to_str().ok())
        .map(|value| value.to_ascii_lowercase().split(',').any(|part| part.trim() == "upgrade"))
        .unwrap_or(false);

    let is_websocket = req
        .headers()
        .get(header::UPGRADE)
        .and_then(|value| value.to_str().ok())
        .map(|value| value.eq_ignore_ascii_case("websocket"))
        .unwrap_or(false);

    has_upgrade_connection && is_websocket
}

async fn proxy_websocket(req: Request<Body>, lb: Arc<LoadBalancer>) -> Response<Body> {
    let backend_url = match lb.select_backend().await {
        Some(url) => url,
        None => {
            error!("WebSocket rejected: no healthy backends");
            return Response::builder()
                .status(StatusCode::SERVICE_UNAVAILABLE)
                .body(Body::from("Service Unavailable: No healthy backends"))
                .unwrap();
        }
    };

    let uri = req.uri().clone();
    let method = req.method().clone();
    let headers = req.headers().clone();
    let uri_str = format!(
        "{}{}",
        backend_url,
        uri.path_and_query().map(|pq| pq.as_str()).unwrap_or("")
    );

    let server_upgrade = upgrade::on(req);

    let mut proxy_req = Request::builder()
        .method(method)
        .uri(&uri_str)
        .body(Body::empty())
        .unwrap();
    *proxy_req.headers_mut() = headers;

    info!("Proxying WebSocket upgrade to: {}", uri_str);

    match lb.client.request(proxy_req).await {
        Ok(mut backend_res) => {
            if backend_res.status() != StatusCode::SWITCHING_PROTOCOLS {
                warn!("Backend did not accept WebSocket upgrade: {} status={}", backend_url, backend_res.status());
                return backend_res;
            }

            let backend_upgrade = upgrade::on(&mut backend_res);
            tokio::spawn(async move {
                match (server_upgrade.await, backend_upgrade.await) {
                    (Ok(mut client_stream), Ok(mut backend_stream)) => {
                        if let Err(error) = copy_bidirectional(&mut client_stream, &mut backend_stream).await {
                            warn!("WebSocket tunnel closed with error: {}", error);
                        }
                    }
                    (Err(error), _) => warn!("Client WebSocket upgrade failed: {}", error),
                    (_, Err(error)) => warn!("Backend WebSocket upgrade failed: {}", error),
                }
            });

            backend_res
        }
        Err(error) => {
            warn!("Failed to proxy WebSocket to {}: {}", backend_url, error);
            lb.mark_unhealthy(&backend_url).await;
            Response::builder()
                .status(StatusCode::BAD_GATEWAY)
                .body(Body::from("Bad Gateway: WebSocket backend failed"))
                .unwrap()
        }
    }
}
