const http = require('node:http');

const pages = Number(process.env.BENCHMARK_PAGES || 1000);
const concurrency = Number(process.env.BENCHMARK_CONCURRENCY || 200);
const linksPerPage = Number(process.env.BENCHMARK_LINKS_PER_PAGE || 8);

const server = http.createServer((req, res) => {
  const id = Number(new URL(req.url || '/', 'http://localhost').pathname.replace('/page/', '') || 0);
  const links = Array.from({ length: linksPerPage }, (_, index) => {
    const next = ((id * linksPerPage + index + 1) % pages) + 1;
    return `<a href="/page/${next}">Page ${next}</a>`;
  }).join('');
  res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
  res.end(`<!doctype html><title>Page ${id}</title><main><h1>Page ${id}</h1>${links}<p>contact${id}@example.com</p></main>`);
});

server.listen(0, '127.0.0.1', async () => {
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('Unable to start benchmark server');
  const origin = `http://127.0.0.1:${address.port}`;
  const visited = new Set();
  const queued = new Set(['/page/1']);
  const queue = ['/page/1'];
  let active = 0;
  let failed = 0;
  const startedAt = Date.now();

  await new Promise((resolve) => {
    const pump = () => {
      while (active < concurrency && queue.length > 0 && visited.size + active < pages) {
        const path = queue.shift();
        if (!path || visited.has(path)) continue;
        active += 1;
        fetchPage(`${origin}${path}`)
          .then((html) => {
            visited.add(path);
            for (const link of extractLinks(html)) {
              if (!queued.has(link) && queued.size < pages) {
                queued.add(link);
                queue.push(link);
              }
            }
          })
          .catch(() => {
            failed += 1;
          })
          .finally(() => {
            active -= 1;
            if ((visited.size >= pages || (queue.length === 0 && active === 0))) resolve(undefined);
            else pump();
          });
      }
    };
    pump();
  });

  const seconds = (Date.now() - startedAt) / 1000;
  console.log(JSON.stringify({
    pagesTarget: pages,
    pagesCompleted: visited.size,
    failed,
    concurrency,
    seconds,
    pagesPerSecond: Math.round(visited.size / seconds)
  }, null, 2));
  server.close();
});

function fetchPage(url) {
  return new Promise((resolve, reject) => {
    http.get(url, (res) => {
      let body = '';
      res.setEncoding('utf8');
      res.on('data', (chunk) => {
        body += chunk;
      });
      res.on('end', () => resolve(body));
    }).on('error', reject);
  });
}

function extractLinks(html) {
  return [...html.matchAll(/href="([^"]+)"/g)].map((match) => match[1]);
}
