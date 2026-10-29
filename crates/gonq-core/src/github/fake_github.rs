//! An in-process HTTP server standing in for github.com / api.github.com in tests.
//! Replies are scripted per path; the last reply of a path repeats. `Reply::drop_connection`
//! closes the socket without answering.

use std::collections::{HashMap, VecDeque};
use std::sync::{Arc, Mutex};
use std::time::Instant;
use tokio::io::{AsyncReadExt, AsyncWriteExt};
use tokio::net::TcpListener;

#[derive(Debug, Clone)]
pub struct Req {
    pub method: String,
    pub path: String,
    pub headers: Vec<(String, String)>,
    pub body: String,
    pub at: Instant,
}

impl Req {
    pub fn header(&self, name: &str) -> Option<&str> {
        self.headers.iter().find(|(k, _)| k.eq_ignore_ascii_case(name)).map(|(_, v)| v.as_str())
    }
}

#[derive(Debug, Clone)]
pub struct Reply {
    pub status: u16,
    pub headers: Vec<(String, String)>,
    pub body: String,
    pub drop: bool,
}

impl Reply {
    pub fn json(status: u16, body: serde_json::Value) -> Self {
        Reply { status, headers: vec![], body: body.to_string(), drop: false }
    }
    pub fn drop_connection() -> Self {
        Reply { status: 0, headers: vec![], body: String::new(), drop: true }
    }
    pub fn header(mut self, k: &str, v: &str) -> Self {
        self.headers.push((k.into(), v.into()));
        self
    }
}

#[derive(Clone)]
pub struct Fake {
    pub base: String,
    pub requests: Arc<Mutex<Vec<Req>>>,
    routes: Arc<Mutex<HashMap<String, VecDeque<Reply>>>>,
}

impl Fake {
    pub async fn start() -> Fake {
        let listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
        let fake = Fake {
            base: format!("http://{}", listener.local_addr().unwrap()),
            requests: Arc::default(),
            routes: Arc::default(),
        };
        let f = fake.clone();
        tokio::spawn(async move {
            loop {
                let Ok((sock, _)) = listener.accept().await else { return };
                let f = f.clone();
                tokio::spawn(async move { f.serve(sock).await });
            }
        });
        fake
    }

    pub fn script(&self, path: &str, replies: Vec<Reply>) {
        self.routes.lock().unwrap().insert(path.into(), replies.into());
    }

    pub fn hits(&self, path: &str) -> Vec<Req> {
        self.requests.lock().unwrap().iter().filter(|r| r.path == path).cloned().collect()
    }

    async fn serve(&self, mut sock: tokio::net::TcpStream) {
        let mut buf = Vec::new();
        let mut chunk = [0u8; 4096];
        let (head_end, content_len) = loop {
            let Ok(n) = sock.read(&mut chunk).await else { return };
            if n == 0 {
                return;
            }
            buf.extend_from_slice(&chunk[..n]);
            if let Some(i) = buf.windows(4).position(|w| w == b"\r\n\r\n") {
                let head = String::from_utf8_lossy(&buf[..i]).to_lowercase();
                let len = head
                    .lines()
                    .find_map(|l| l.strip_prefix("content-length:").and_then(|v| v.trim().parse::<usize>().ok()))
                    .unwrap_or(0);
                break (i + 4, len);
            }
        };
        while buf.len() < head_end + content_len {
            let Ok(n) = sock.read(&mut chunk).await else { return };
            if n == 0 {
                break;
            }
            buf.extend_from_slice(&chunk[..n]);
        }
        let head = String::from_utf8_lossy(&buf[..head_end]).to_string();
        let mut lines = head.lines();
        let mut first = lines.next().unwrap_or("").split(' ');
        let method = first.next().unwrap_or("").to_string();
        let target = first.next().unwrap_or("").to_string();
        let headers = lines
            .filter_map(|l| l.split_once(':').map(|(k, v)| (k.trim().to_string(), v.trim().to_string())))
            .collect();
        let path = target.split('?').next().unwrap_or("").to_string();
        self.requests.lock().unwrap().push(Req {
            method,
            path: target.clone(),
            headers,
            body: String::from_utf8_lossy(&buf[head_end..]).to_string(),
            at: Instant::now(),
        });
        let reply = {
            let mut routes = self.routes.lock().unwrap();
            match routes.get_mut(&path) {
                Some(q) if q.len() > 1 => q.pop_front(),
                Some(q) => q.front().cloned(),
                None => None,
            }
        }
        .unwrap_or_else(|| Reply::json(404, serde_json::json!({"message": "Not Found"})));
        if reply.drop {
            return;
        }
        let mut out = format!("HTTP/1.1 {} X\r\ncontent-type: application/json\r\ncontent-length: {}\r\nconnection: close\r\n", reply.status, reply.body.len());
        for (k, v) in &reply.headers {
            out.push_str(&format!("{k}: {v}\r\n"));
        }
        out.push_str("\r\n");
        out.push_str(&reply.body);
        let _ = sock.write_all(out.as_bytes()).await;
        let _ = sock.shutdown().await;
    }
}
