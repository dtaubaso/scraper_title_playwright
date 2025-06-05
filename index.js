const express = require('express');
const { chromium, devices } = require('playwright-extra');
const stealth = require('puppeteer-extra-plugin-stealth')()
chromium.use(stealth);

const PORT = 8080;
const HOST = '0.0.0.0';
const app = express();
app.use(express.json());

app.post('/page-source', async (req, res) => {
    const url = req.body.url;
    console.log(`Requested URL for page source: ${url}`);
    try {
        const rawContent = await getPageSource(url);
        // Devolver el contenido como binario sin procesar
        res.set('Content-Type', 'application/octet-stream');
        res.send(Buffer.from(rawContent, 'utf8'));
    } catch (err) {
        console.error(`Error processing URL: ${url}`, err);
        res.status(500).send(`Failed to process the URL: ${err.message}`);
    }
});

// Ejemplo del endpoint para extraer título con Cheerio (sin cambios)
app.post('/title', async (req, res) => {
    const url = req.body.url;
    console.log(`Requested URL for title extraction: ${url}`);
    try {
        const rawContent = await getPageSource(url);
        const data = extractTitleCheerio(rawContent);
        res.json({ page: url, ...data });
    } catch (err) {
        console.error(`Error processing URL: ${url}`, err);
        res.status(500).json({ error: "Failed to process the URL", details: err.message });
    }
});

async function getPageSource(url) {
    const device = devices['Pixel 7'];
    const browser = await chromium.launch({ headless: true }); // Se mantiene headless
    const context = await browser.newContext({
        ...device,
        javaScriptEnabled: true,
        userAgent: 'Mozilla/5.0 (Linux; Android 14; Pixel 7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.6723.31 Mobile Safari/537.36'
    });

    // Añadir scripts para evitar detección
    await context.addInitScript(() => {
        Object.defineProperty(navigator, 'webdriver', { get: () => undefined });
        Object.defineProperty(navigator, 'languages', { get: () => ['en-US', 'en'] });
        Object.defineProperty(navigator, 'hardwareConcurrency', { get: () => 4 });
    });

    const page = await context.newPage();

    // Interceptar y abortar solicitudes que dan problemas, por ejemplo, de captcha.
    await page.route('**/captcha-delivery.com/**', route => route.abort());

    page.on('console', msg => console.log(`PAGE LOG: ${msg.text()}`));
    page.on('requestfailed', request => {
        console.error(`Request failed: ${request.url()} - ${request.failure().errorText}`);
    });

    await page.goto(url, { waitUntil: 'domcontentloaded' });
    const content = await page.content();
    await browser.close();
    return content;
}

function extractTitleCheerio(html) {
    const cheerio = require('cheerio');
    const $ = cheerio.load(html);

    let title = null;
    const titleSelectors = ['h1', 'meta[property="og:title"]', 'title'];
    for (const selector of titleSelectors) {
        if (selector.startsWith('meta')) {
            const metaContent = $(selector).attr('content');
            if (metaContent) {
                title = metaContent.trim();
                break;
            }
        } else {
            const text = $(selector).first().text();
            if (text) {
                title = text.trim();
                break;
            }
        }
    }

    let metaDescription = null;
    const descriptionSelectors = [
        'meta[name="description"]',
        'meta[property="og:description"]',
        'meta[name="twitter:description"]'
    ];
    for (const selector of descriptionSelectors) {
        const content = $(selector).attr('content');
        if (content) {
            metaDescription = content.trim();
            break;
        }
    }

    return { title, description: metaDescription };
}

app.listen(PORT, HOST, () => {
    console.log(`Running on http://${HOST}:${PORT}`);
});