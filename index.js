const express = require('express');
const { chromium, devices } = require('playwright-extra');
const stealth = require('puppeteer-extra-plugin-stealth')()
chromium.use(stealth);

const PORT = 8080;
const HOST = '0.0.0.0';
//const HOST = 'localhost';
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


app.post('/xml-source', async (req, res) => {
    const url = req.body.url;
    if (!url) return res.status(400).send("URL is required");

    console.log(`Requested URL for XML source: ${url}`);
    
    try {
        const rawContent = await getXmlSource(url);
        
        // Usar text/xml es más limpio para archivos de sitemap
        res.set('Content-Type', 'text/xml; charset=utf-8');
        
        // No es estrictamente necesario pasarlo a Buffer si ya es un string,
        // pero dejarlo así no rompe nada.
        res.send(rawContent); 

    } catch (err) {
        console.error(`Error processing URL: ${url}`, err);
        // Si el error es un timeout de Playwright, podrías devolver un 504
        const statusCode = err.message.includes('timeout') ? 504 : 500;
        res.status(statusCode).send(`Failed to process the URL: ${err.message}`);
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

// Solo UAs basados en Chromium — el motor de Playwright ES Chromium,
// mandar un UA de Firefox sería inconsistente con las señales internas del browser.
const desktopUserAgents = [
    { ua: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36',       brand: '"Google Chrome";v="125", "Chromium";v="125", "Not-A.Brand";v="24"', platform: 'Windows' },
    { ua: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36', brand: '"Google Chrome";v="125", "Chromium";v="125", "Not-A.Brand";v="24"', platform: 'macOS'   },
    { ua: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',       brand: '"Google Chrome";v="124", "Chromium";v="124", "Not-A.Brand";v="24"', platform: 'Windows' },
    { ua: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Edg/125.0.0.0 Safari/537.36',          brand: '"Microsoft Edge";v="125", "Chromium";v="125", "Not-A.Brand";v="24"', platform: 'Windows' },
];

// Devuelve un objeto { ua, brand, platform } aleatorio
function getRandomDesktopUserAgent() {
    return desktopUserAgents[Math.floor(Math.random() * desktopUserAgents.length)];
}

async function getPageSource(url) {
    const { ua: userAgent } = getRandomDesktopUserAgent();
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
        await page.goto(url, { waitUntil: 'networkidle', timeout: 9000 }); // Aumentamos el timeout
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




async function getXmlSource(url) {
    console.log(`getXmlSource: fetching ${url}`);
    // impit es un ESM-only package, usamos dynamic import desde CJS
    const { Impit } = await import('impit');
    const client = new Impit({ browser: 'chrome' });
    const response = await client.fetch(url);
    if (!response.ok) {
        throw new Error(`HTTP ${response.status} ${response.statusText} for ${url}`);
    }
    return await response.text();
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