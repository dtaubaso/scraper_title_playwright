const express = require('express');
const { chromium, devices } = require('playwright-extra');
const stealth = require('puppeteer-extra-plugin-stealth')()
chromium.use(stealth);

const PORT = 8080;
//const HOST = '0.0.0.0';
const HOST = 'localhost';
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

const desktopUserAgents = [
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36',
    'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36',
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:126.0) Gecko/20100101 Firefox/126.0',
    'Mozilla/5.0 (Macintosh; Intel Mac OS X 10.15; rv:126.0) Gecko/20100101 Firefox/126.0',
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Edge/125.0.0.0 Safari/537.36'
];

// Función para obtener un User-Agent aleatorio de la lista
function getRandomDesktopUserAgent() {
    const randomIndex = Math.floor(Math.random() * desktopUserAgents.length);
    return desktopUserAgents[randomIndex];
}

async function getPageSource(url) { // Renombramos la función para mayor claridad o mantenemos el nombre
    const userAgent = getRandomDesktopUserAgent();
    console.log(`getPageSource (extract from viewer method): Using UA "${userAgent}" for URL: ${url}`);

    const browser = await chromium.launch({ headless: true });
    const context = await browser.newContext({
        userAgent: userAgent,
        javaScriptEnabled: true,
        viewport: { width: 1920, height: 1080 },
        deviceScaleFactor: 1,
        isMobile: false,
        hasTouch: false,
    });

    await context.addInitScript((uaString) => {
        Object.defineProperty(navigator, 'webdriver', { get: () => undefined });
        Object.defineProperty(navigator, 'languages', { get: () => ['en-US', 'en', 'es-ES', 'es'] });
        let platformValue = 'Linux x86_64';
        if (uaString.includes('Win')) platformValue = 'Win32';
        else if (uaString.includes('Mac')) platformValue = 'MacIntel';
        Object.defineProperty(navigator, 'platform', { get: () => platformValue });
        Object.defineProperty(navigator, 'deviceMemory', { get: () => 8 });
        Object.defineProperty(navigator, 'hardwareConcurrency', { get: () => 8 });
    }, userAgent);

    const page = await context.newPage();

    await page.route('**/captcha-delivery.com/**', route => route.abort());
    page.on('console', msg => console.log(`PAGE LOG: ${msg.text()}`));
    page.on('requestfailed', request => {
        console.error(`Request failed: ${request.url()} - ${request.failure().errorText}`);
    });

    try {
        console.log(`getPageSource (extract from viewer method): Navigating to ${url}`);
        // Usamos 'networkidle' para dar tiempo a que todo cargue, incluyendo scripts de Cloudflare
        await page.goto(url, { waitUntil: 'load', timeout: 9000 }); // Aumentamos el timeout
        console.log(`getPageSource (extract from viewer method): Navigation to ${page.url()} complete.`);

        // Intenta localizar el div del visor XML de WebKit/Chromium
        const xmlViewerDiv = page.locator('#webkit-xml-viewer-source-xml');
        const viewerDetected = await xmlViewerDiv.count() > 0;

        let finalContent;

        if (viewerDetected) {
            console.log('getPageSource (extract from viewer method): XML viewer detected. Extracting content...');
            finalContent = await xmlViewerDiv.innerHTML();
        } else {
            console.log('getPageSource (extract from viewer method): XML viewer not detected. Returning full page content (might be Cloudflare challenge or other HTML).');
            finalContent = await page.content();
        }

        await browser.close();
        return finalContent;
    } catch (error) {
        console.error(`getPageSource (extract from viewer method): Error for URL ${url}:`, error);
        await browser.close();
        throw error;
    }
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