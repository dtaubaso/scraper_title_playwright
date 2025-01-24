const express = require('express');
const { chromium, devices } = require('playwright');

const PORT = 8080;
const HOST = '0.0.0.0';
// const HOST = 'localhost';

const app = express();
app.use(express.json());

app.post('/', async function (req, res) {
    const url = req.body.url;
    console.log(`Requested URL: ${url}`);
    try {
        const data = await getPage(url);
        res.json(data);
    } catch (err) {
        console.error(`Error processing URL: ${url}`, err);
        res.status(500).json({ error: "Failed to process the URL", details: err.message });
    }
});

async function getPage(url) {
    const iPhone = devices['Pixel 7'];
    const browser = await chromium.launch({
        headless: true,
        args: [
            "--disable-blink-features=AutomationControlled",
            "--disable-dev-shm-usage",
            "--no-sandbox",
            "--enable-javascript",
            "--disable-gpu",
            "--disable-extensions",
            "--headless=new"
        ]
    });

    const context = await browser.newContext({
        ...iPhone,
        javaScriptEnabled: true
    });

    // Añadir scripts para evitar detección de automatización
    await context.addInitScript(() => {
        Object.defineProperty(navigator, 'webdriver', { get: () => undefined });
        Object.defineProperty(navigator, 'platform', { get: () => 'iPhone' });
        Object.defineProperty(navigator, 'languages', { get: () => ['en-US', 'en'] });
        Object.defineProperty(navigator, 'hardwareConcurrency', { get: () => 4 });
    });

    const page = await context.newPage();

    // Capturar logs y errores de la página
    page.on('console', msg => console.log(`PAGE LOG: ${msg.text()}`));
    page.on('requestfailed', request => {
        console.error(`Request failed: ${request.url()} - ${request.failure().errorText}`);
    });

    // Navegar a la URL
    await page.goto(url, { waitUntil: 'domcontentloaded' });

    // Extraer título
    const title = await page.evaluate(() => {
        const selectors = ['h1', 'meta[property="og:title"]', 'title'];
        for (const selector of selectors) {
            const element = document.querySelector(selector);
            if (element) {
                return selector === 'h1' || selector === 'title'
                    ? element.textContent.trim()
                    : element.getAttribute('content');
            }
        }
        return null;
    });

    // Extraer meta descripción
    const metaDescription = await page.evaluate(() => {
        const selectors = [
            'meta[name="description"]',
            'meta[property="og:description"]',
            'meta[name="twitter:description"]'
        ];
        for (const selector of selectors) {
            const element = document.querySelector(selector);
            if (element) {
                return element.getAttribute('content');
            }
        }
        return null;
    });

    // Preparar datos
    const data = { page: url, title, description: metaDescription };
    await browser.close();
    return data;
}

app.listen(PORT, HOST, () => {
    console.log(`Running on http://${HOST}:${PORT}`);
});