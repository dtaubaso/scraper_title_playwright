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


async function waitForCfClear(page, label) {
    // Poll until the title is no longer a CF challenge page (max ~45s)
    for (let i = 0; i < 15; i++) {
        const title = await page.title();
        if (!title.includes('Just a moment') && !title.includes('Checking your browser')) {
            console.log(`${label}: CF resolved after ${i * 3}s, title="${title}"`);
            return;
        }
        console.log(`${label}: still on CF challenge (${i * 3}s), title="${title}"`);
        await page.waitForTimeout(3000);
    }
    throw new Error(`${label}: Cloudflare challenge did not resolve within 45s`);
}

async function getXmlSource(url) {
    const { ua: userAgent, brand, platform } = getRandomDesktopUserAgent();
    console.log(`getXmlSource: Using UA "${userAgent}" for URL: ${url}`);

    // Extraer la homepage para hacer el warm-up de CF ahí primero
    const parsedUrl = new URL(url);
    const homeUrl = parsedUrl.origin + '/';

    const browser = await chromium.launch({
        headless: true,
        args: [
            '--no-sandbox',
            '--disable-setuid-sandbox',
            '--disable-blink-features=AutomationControlled',
            '--disable-infobars',
            '--disable-dev-shm-usage',
            '--disable-accelerated-2d-canvas',
            '--no-first-run',
            '--no-zygote',
            '--disable-gpu',
            '--window-size=1920,1080',
            '--lang=en-US,en',
        ],
    });
    const context = await browser.newContext({
        userAgent: userAgent,
        javaScriptEnabled: true,
        viewport: { width: 1920, height: 1080 },
        deviceScaleFactor: 1,
        isMobile: false,
        hasTouch: false,
        locale: 'en-US',
        timezoneId: 'America/New_York',
        permissions: ['geolocation'],
    });

    // Mismo script anti-detección que getPageSource
    await context.addInitScript((uaString) => {
        Object.defineProperty(navigator, 'webdriver', { get: () => undefined });
        Object.defineProperty(navigator, 'languages', { get: () => ['en-US', 'en', 'es-ES', 'es'] });
        let platformValue = 'Linux x86_64';
        if (uaString.includes('Win')) platformValue = 'Win32';
        else if (uaString.includes('Mac')) platformValue = 'MacIntel';
        Object.defineProperty(navigator, 'platform', { get: () => platformValue });
        Object.defineProperty(navigator, 'deviceMemory', { get: () => 8 });
        Object.defineProperty(navigator, 'hardwareConcurrency', { get: () => 8 });
        // Ocultar que es headless
        Object.defineProperty(navigator, 'plugins', { get: () => [1, 2, 3, 4, 5] });
        Object.defineProperty(navigator, 'mimeTypes', { get: () => [1, 2, 3] });
        window.chrome = { runtime: {} };
        Object.defineProperty(screen, 'colorDepth', { get: () => 24 });
    }, userAgent);

    const page = await context.newPage();

    // Simular headers realistas
    await page.setExtraHTTPHeaders({
        'Accept-Language': 'en-US,en;q=0.9',
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8',
        'sec-ch-ua': brand,
        'sec-ch-ua-mobile': '?0',
        'sec-ch-ua-platform': `"${platform}"`,
        'sec-ch-ua-platform-version': platform === 'Windows' ? '"15.0.0"' : '"14.0.0"',
        'Sec-Fetch-Dest': 'document',
        'Sec-Fetch-Mode': 'navigate',
        'Sec-Fetch-Site': 'none',
        'Upgrade-Insecure-Requests': '1',
    });

    try {
        // 1. Warm-up en la homepage: CF resuelve el challenge aquí y setea cf_clearance
        //    para todo el dominio. Navegar directo al XML siempre dispara managed challenge.
        console.log(`getXmlSource: warming up on homepage ${homeUrl}`);
        await page.goto(homeUrl, { waitUntil: 'domcontentloaded', timeout: 60000 });
        await waitForCfClear(page, 'getXmlSource[homepage]');

        // Espera extra para que la red (incluyendo recursos JS de CF) se estabilice
        await page.waitForLoadState('networkidle', { timeout: 20000 }).catch(() => {});
        console.log(`getXmlSource: homepage loaded, cf_clearance cookie should be set`);

        // 2. Navegar al XML dentro del mismo contexto (cookies ya incluyen cf_clearance)
        console.log(`getXmlSource: navigating to XML URL ${url}`);
        await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 60000 });
        await waitForCfClear(page, 'getXmlSource[xml]');

        // 3. Fetch interno para obtener el XML crudo (sin render del visor de Chrome)
        const xmlPuro = await page.evaluate(async (fetchUrl) => {
            const response = await fetch(fetchUrl, { credentials: 'include' });
            return await response.text();
        }, url);

        await browser.close();
        return xmlPuro;

    } catch (error) {
        console.error(`getXmlSource: Error for URL ${url}:`, error);
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