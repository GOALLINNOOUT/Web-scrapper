package main

import (
	"bytes"
	"context"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"html"
	"io"
	"net/http"
	"net/url"
	"os"
	"regexp"
	"strings"
	"sync"
	"time"

	"github.com/playwright-community/playwright-go"
)

type Config struct {
	SeedURL                    string `json:"seedUrl"`
	MaxDepth                   int    `json:"maxDepth"`
	MaxPages                   int    `json:"maxPages"`
	SameDomainOnly             bool   `json:"sameDomainOnly"`
	Concurrency                int    `json:"concurrency"`
	RequestTimeoutMs           int    `json:"requestTimeoutMs"`
	MaxRuntimeMs               int    `json:"maxRuntimeMs"`
	MaxResponseBytes           int64  `json:"maxResponseBytes"`
	UserAgent                  string `json:"userAgent"`
	RenderWhenStaticLinksBelow int    `json:"renderWhenStaticLinksBelow"`
	RenderEnabled              bool   `json:"renderEnabled"`
	RenderConcurrency          int    `json:"renderConcurrency"`
	RenderTimeoutMs            int    `json:"renderTimeoutMs"`
	IncludeContent             bool   `json:"includeContent"`
}

type task struct {
	URL       string `json:"url"`
	Depth     int    `json:"depth"`
	ParentURL string `json:"parentUrl,omitempty"`
}

type event map[string]any

type renderResult struct {
	html     string
	finalURL string
	err      error
}

var (
	hrefRe       = regexp.MustCompile(`(?is)<a[^>]+href\s*=\s*["']?([^"' >#]+)`)
	titleRe      = regexp.MustCompile(`(?is)<title[^>]*>(.*?)</title>`)
	descRe       = regexp.MustCompile(`(?is)<meta[^>]+name\s*=\s*["']description["'][^>]+content\s*=\s*["']([^"']+)`)
	tagRe        = regexp.MustCompile(`(?is)<script[^>]*>.*?</script>|<style[^>]*>.*?</style>|<[^>]+>`)
	spaceRe      = regexp.MustCompile(`\s+`)
	emailRe      = regexp.MustCompile(`[a-zA-Z0-9._%+\-]+@[a-zA-Z0-9.\-]+\.[a-zA-Z]{2,}`)
	nonPageExtRe = regexp.MustCompile(`(?i)\.(7z|aac|avi|avif|bmp|css|csv|docx?|eot|gif|ico|jpe?g|js|json|map|mjs|mov|mp3|mp4|ogg|otf|pdf|png|rar|svg|tar|ttf|txt|wav|webm|webp|woff2?|xlsx?|xml|zip)$`)
)

func main() {
	var cfg Config
	if err := json.NewDecoder(os.Stdin).Decode(&cfg); err != nil {
		emit(event{"type": "crawl_error", "error": "invalid_config: " + err.Error()})
		os.Exit(2)
	}
	normalizeConfig(&cfg)

	ctx, cancel := context.WithTimeout(context.Background(), time.Duration(cfg.MaxRuntimeMs)*time.Millisecond)
	defer cancel()

	emit(event{"type": "crawl_started", "seedUrl": cfg.SeedURL, "concurrency": cfg.Concurrency})
	heartbeatDone := make(chan struct{})
	go func() {
		ticker := time.NewTicker(10 * time.Second)
		defer ticker.Stop()
		for {
			select {
			case <-ticker.C:
				emit(event{"type": "heartbeat"})
			case <-heartbeatDone:
				return
			case <-ctx.Done():
				return
			}
		}
	}()
	result := run(ctx, cfg)
	close(heartbeatDone)
	if result.err != nil {
		emit(event{"type": "crawl_error", "error": result.err.Error(), "reason": result.reason, "pagesCrawled": result.pages})
		if result.reason == "runtime_budget_exceeded" {
			os.Exit(3)
		}
		os.Exit(1)
	}
	emit(event{"type": "crawl_finished", "reason": result.reason, "pagesCrawled": result.pages})
}

type runResult struct {
	pages  int
	reason string
	err    error
}

func run(ctx context.Context, cfg Config) runResult {
	seed, err := url.Parse(cfg.SeedURL)
	if err != nil {
		return runResult{err: err, reason: "invalid_seed"}
	}
	client := &http.Client{Timeout: time.Duration(cfg.RequestTimeoutMs) * time.Millisecond}
	tasks := make(chan task, cfg.Concurrency*8)
	discovered := make(chan task, cfg.Concurrency*16)
	renderSlots := make(chan struct{}, cfg.RenderConcurrency)
	var wg sync.WaitGroup
	var mu sync.Mutex
	visited := map[string]bool{}
	pages := 0
	failures := 0
	active := 0
	stopped := false

	enqueue := func(item task) {
		mu.Lock()
		if stopped || visited[item.URL] || item.Depth > cfg.MaxDepth || (cfg.MaxPages > 0 && len(visited) >= cfg.MaxPages) {
			mu.Unlock()
			return
		}
		visited[item.URL] = true
		mu.Unlock()
		select {
		case tasks <- item:
		case <-ctx.Done():
		}
	}

	for i := 0; i < cfg.Concurrency; i++ {
		wg.Add(1)
		go func() {
			defer wg.Done()
			for item := range tasks {
				select {
				case <-ctx.Done():
					return
				default:
				}
				mu.Lock()
				active++
				mu.Unlock()
				emit(event{"type": "page_started", "url": item.URL, "depth": item.Depth, "parentUrl": item.ParentURL})
				page, links, err := fetchAndExtract(ctx, client, cfg, item, renderSlots)
				if err != nil {
					mu.Lock()
					failures++
					mu.Unlock()
					emit(event{"type": "page_failed", "url": item.URL, "depth": item.Depth, "parentUrl": item.ParentURL, "error": err.Error()})
				} else {
					mu.Lock()
					pages++
					reachedMax := cfg.MaxPages > 0 && pages >= cfg.MaxPages
					mu.Unlock()
					emit(page)
					emit(event{"type": "links_discovered", "url": item.URL, "links": links})
					if !reachedMax && item.Depth < cfg.MaxDepth {
						for _, link := range links {
							if acceptURL(link, seed, cfg.SameDomainOnly) {
								select {
								case discovered <- task{URL: link, Depth: item.Depth + 1, ParentURL: item.URL}:
								case <-ctx.Done():
								}
							}
						}
					}
				}
				mu.Lock()
				active--
				mu.Unlock()
			}
		}()
	}

	enqueue(task{URL: cfg.SeedURL, Depth: 0})
	idle := time.NewTimer(250 * time.Millisecond)
	defer idle.Stop()

	for {
		select {
		case item := <-discovered:
			enqueue(item)
		case <-idle.C:
			mu.Lock()
			isIdle := active == 0 && len(tasks) == 0 && len(discovered) == 0
			mu.Unlock()
			if isIdle {
				mu.Lock()
				stopped = true
				mu.Unlock()
				close(tasks)
				wg.Wait()
				if pages == 0 && failures > 0 {
					return runResult{pages: pages, reason: "no_pages_crawled", err: errors.New("all attempted pages failed")}
				}
				return runResult{pages: pages, reason: "complete"}
			}
			idle.Reset(250 * time.Millisecond)
		case <-ctx.Done():
			mu.Lock()
			stopped = true
			mu.Unlock()
			close(tasks)
			wg.Wait()
			return runResult{pages: pages, reason: "runtime_budget_exceeded", err: ctx.Err()}
		}
	}
}

func fetchAndExtract(ctx context.Context, client *http.Client, cfg Config, item task, renderSlots chan struct{}) (event, []string, error) {
	start := time.Now()
	htmlText, statusCode, finalURL, err := fetchHTML(ctx, client, cfg, item.URL)
	if err != nil {
		return nil, nil, err
	}
	renderUsed := false
	links := extractLinks(htmlText, finalURL)
	if cfg.RenderEnabled && len(links) < cfg.RenderWhenStaticLinksBelow {
		emit(event{"type": "render_started", "url": item.URL, "linkCount": len(links)})
		if rendered, renderedURL, err := renderHTML(ctx, cfg, finalURL, renderSlots); err == nil && rendered != "" {
			renderUsed = true
			htmlText = rendered
			if renderedURL != "" {
				finalURL = renderedURL
			}
			links = unique(append(links, extractLinks(rendered, finalURL)...))
		} else if err != nil {
			emit(event{"type": "render_failed", "url": item.URL, "error": err.Error()})
		}
	}
	text := extractText(htmlText)
	title := firstMatch(titleRe, htmlText)
	description := firstMatch(descRe, htmlText)
	emails := unique(emailRe.FindAllString(htmlText, -1))
	sum := sha256.Sum256([]byte(text))
	return event{
		"type":        "page_result",
		"url":         item.URL,
		"finalUrl":    finalURL,
		"depth":       item.Depth,
		"parentUrl":   item.ParentURL,
		"statusCode":  statusCode,
		"durationMs":  time.Since(start).Milliseconds(),
		"title":       title,
		"description": description,
		"links":       links,
		"emails":      emails,
		"text":        text,
		"textSnippet": truncate(text, 1500),
		"contentHash": hex.EncodeToString(sum[:]),
		"html":        htmlText,
		"renderUsed":  renderUsed,
	}, links, nil
}

func fetchHTML(ctx context.Context, client *http.Client, cfg Config, targetURL string) (string, int, string, error) {
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, targetURL, nil)
	if err != nil {
		return "", 0, "", err
	}
	req.Header.Set("User-Agent", cfg.UserAgent)
	req.Header.Set("Accept", "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8")
	res, err := client.Do(req)
	if err != nil {
		return "", 0, "", err
	}
	defer res.Body.Close()
	contentType := strings.ToLower(res.Header.Get("Content-Type"))
	if !strings.Contains(contentType, "text/html") && !strings.Contains(contentType, "application/xhtml") {
		return "", res.StatusCode, res.Request.URL.String(), fmt.Errorf("unsupported_content_type: %s", contentType)
	}
	body, tooLarge, err := readLimited(res.Body, cfg.MaxResponseBytes)
	if err != nil {
		return "", res.StatusCode, res.Request.URL.String(), err
	}
	if tooLarge {
		return "", res.StatusCode, res.Request.URL.String(), errors.New("response_too_large")
	}
	return string(body), res.StatusCode, res.Request.URL.String(), nil
}

func renderHTML(ctx context.Context, cfg Config, targetURL string, renderSlots chan struct{}) (string, string, error) {
	select {
	case renderSlots <- struct{}{}:
		defer func() { <-renderSlots }()
	case <-ctx.Done():
		return "", "", ctx.Err()
	}

	timeout := time.Duration(cfg.RenderTimeoutMs) * time.Millisecond
	if timeout <= 0 {
		timeout = 15 * time.Second
	}
	result := make(chan renderResult, 1)
	go func() {
		html, finalURL, err := renderHTMLUnsafe(cfg, targetURL)
		result <- renderResult{html: html, finalURL: finalURL, err: err}
	}()

	select {
	case value := <-result:
		return value.html, value.finalURL, value.err
	case <-time.After(timeout + 5*time.Second):
		return "", "", fmt.Errorf("render_timeout_after_%s", timeout)
	case <-ctx.Done():
		return "", "", ctx.Err()
	}
}

func renderHTMLUnsafe(cfg Config, targetURL string) (string, string, error) {
	pw, err := playwright.Run()
	if err != nil {
		return "", "", err
	}
	defer pw.Stop()

	browser, err := pw.Chromium.Launch(playwright.BrowserTypeLaunchOptions{
		Headless: playwright.Bool(true),
		Args: []string{
			"--no-sandbox",
			"--disable-dev-shm-usage",
			"--disable-gpu",
		},
	})
	if err != nil {
		return "", "", err
	}
	defer browser.Close()

	page, err := browser.NewPage(playwright.BrowserNewPageOptions{
		UserAgent: playwright.String(cfg.UserAgent),
	})
	if err != nil {
		return "", "", err
	}
	defer page.Close()

	timeout := float64(cfg.RenderTimeoutMs)
	_, err = page.Goto(targetURL, playwright.PageGotoOptions{
		Timeout:   playwright.Float(timeout),
		WaitUntil: playwright.WaitUntilStateDomcontentloaded,
	})
	if err != nil {
		return "", "", err
	}
	_ = page.WaitForLoadState(playwright.PageWaitForLoadStateOptions{
		State:   playwright.LoadStateNetworkidle,
		Timeout: playwright.Float(timeout / 2),
	})
	content, err := page.Content()
	if err != nil {
		return "", "", err
	}
	return content, page.URL(), nil
}

func normalizeConfig(cfg *Config) {
	if cfg.Concurrency < 1 {
		cfg.Concurrency = 5
	}
	if cfg.Concurrency > 10 {
		cfg.Concurrency = 10
	}
	if cfg.RequestTimeoutMs <= 0 {
		cfg.RequestTimeoutMs = 15000
	}
	if cfg.MaxRuntimeMs <= 0 {
		cfg.MaxRuntimeMs = 20 * 60 * 1000
	}
	if cfg.MaxResponseBytes <= 0 {
		cfg.MaxResponseBytes = 2 * 1024 * 1024
	}
	if cfg.UserAgent == "" {
		cfg.UserAgent = "WebIntelligenceCrawler/1.0"
	}
	if cfg.RenderWhenStaticLinksBelow < 0 {
		cfg.RenderWhenStaticLinksBelow = 0
	}
	if cfg.RenderConcurrency < 1 {
		cfg.RenderConcurrency = 1
	}
	if cfg.RenderConcurrency > 2 {
		cfg.RenderConcurrency = 2
	}
	if cfg.RenderTimeoutMs <= 0 {
		cfg.RenderTimeoutMs = 15000
	}
}

func readLimited(reader io.Reader, max int64) ([]byte, bool, error) {
	var buf bytes.Buffer
	limit := max + 1
	n, err := io.Copy(&buf, io.LimitReader(reader, limit))
	if err != nil {
		return nil, false, err
	}
	if n > max {
		return nil, true, nil
	}
	return buf.Bytes(), false, nil
}

func extractLinks(htmlText, base string) []string {
	matches := hrefRe.FindAllStringSubmatch(htmlText, -1)
	values := make([]string, 0, len(matches))
	for _, match := range matches {
		if len(match) < 2 {
			continue
		}
		if normalized := normalizeLink(match[1], base); normalized != "" {
			values = append(values, normalized)
		}
	}
	return unique(values)
}

func normalizeLink(raw, base string) string {
	raw = strings.TrimSpace(html.UnescapeString(raw))
	if raw == "" || strings.HasPrefix(raw, "#") {
		return ""
	}
	baseURL, err := url.Parse(base)
	if err != nil {
		return ""
	}
	parsed, err := url.Parse(raw)
	if err != nil {
		return ""
	}
	resolved := baseURL.ResolveReference(parsed)
	if resolved.Scheme != "http" && resolved.Scheme != "https" {
		return ""
	}
	resolved.Fragment = ""
	resolved.User = nil
	if resolved.Path != "/" {
		resolved.Path = strings.TrimRight(resolved.Path, "/")
	}
	if nonPageExtRe.MatchString(resolved.Path) {
		return ""
	}
	return resolved.String()
}

func acceptURL(value string, seed *url.URL, sameDomainOnly bool) bool {
	parsed, err := url.Parse(value)
	if err != nil || (parsed.Scheme != "http" && parsed.Scheme != "https") {
		return false
	}
	if sameDomainOnly && comparableHost(parsed.Hostname()) != comparableHost(seed.Hostname()) {
		return false
	}
	return !nonPageExtRe.MatchString(parsed.Path)
}

func comparableHost(host string) string {
	return strings.TrimPrefix(strings.ToLower(host), "www.")
}

func extractText(htmlText string) string {
	stripped := tagRe.ReplaceAllString(htmlText, " ")
	return strings.TrimSpace(spaceRe.ReplaceAllString(html.UnescapeString(stripped), " "))
}

func firstMatch(re *regexp.Regexp, value string) string {
	match := re.FindStringSubmatch(value)
	if len(match) < 2 {
		return ""
	}
	return strings.TrimSpace(html.UnescapeString(tagRe.ReplaceAllString(match[1], " ")))
}

func unique(values []string) []string {
	seen := map[string]bool{}
	out := make([]string, 0, len(values))
	for _, value := range values {
		value = strings.TrimSpace(value)
		if value == "" || seen[value] {
			continue
		}
		seen[value] = true
		out = append(out, value)
	}
	return out
}

func truncate(value string, max int) string {
	if len(value) <= max {
		return value
	}
	return value[:max]
}

func emit(value event) {
	value["at"] = time.Now().UTC().Format(time.RFC3339Nano)
	encoded, err := json.Marshal(value)
	if err != nil {
		fmt.Fprintf(os.Stderr, "json marshal failed: %v\n", err)
		return
	}
	fmt.Println(string(encoded))
}
