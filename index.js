const express = require('express');
const { chromium, devices } = require('playwright');

const PORT = 8080;
const HOST = '0.0.0.0';
//const HOST = 'localhost';

const app = express();
app.use(express.json()) 

app.post('/', async function (req, res) {

    var url = req.body.url;
    console.log(url)
    try{ 
        var data = await getPage(url);

    }
       catch(err){
        data = "Error";
        console.log(err);
       } 

       res.json(data);

});

async function getPage(url){

    const iPhone = devices['iPhone 12'];
      // Configurar el navegador y el contexto con emulación
      const browser = await chromium.launch({ headless: true,
        args:["--disable-blink-features=AutomationControlled",
            "--disable-dev-shm-usage",
             "--no-sandbox",
             "--enable-javascript",
             "--disable-gpu",
             "--disable-extensions",
             "--headless=new"
             ]
       }); // Cambia a true si quieres usar modo headless
      const context = await browser.newContext({
          ...iPhone,
          javaScriptEnabled: true // JavaScript está habilitado por defecto, pero lo especificamos
      });
  
      // Deshabilitar la detección de headless
      await context.addInitScript(() => {
          Object.defineProperty(navigator, 'webdriver', {
              get: () => undefined
          });
      });
  
      // Otras propiedades del navegador para evitar detección
      await context.addInitScript(() => {
          Object.defineProperty(navigator, 'platform', {
              get: () => 'iPhone'
          });
          Object.defineProperty(navigator, 'languages', {
              get: () => ['en-US', 'en']
          });
      });

    const page = await context.newPage();
    await page.goto(url, { waitUntil: 'domcontentloaded' });

    console.log(await page.content());

    // Extraer el título, probando diferentes tipos
    const title = await page.evaluate(() => {
        const selectors = [
            'h1',                           // H1 en la página
            'meta[property="og:title"]',   // Open Graph Title
            'title'                        // Título de la página
        ];

        for (const selector of selectors) {
            const element = document.querySelector(selector);
            if (element) {
                // Si es un h1 o un title, devolvemos el textContent; si es un meta, devolvemos el atributo content
                return selector === 'h1' || selector === 'title'
                    ? element.textContent.trim()
                    : element.getAttribute('content');
            }
        }

        // Si no se encuentra ningún título, devuelve null
        return null;
    });

    // Extraer el contenido de la meta description, probando diferentes tipos
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

        // Si no se encuentra ninguna, devuelve null
        return "";
    });

    
    // Agregar los datos al array
    const data = { 'page': url, 'title': title, 'description': metaDescription };
    await browser.close();
    return data

}

app.listen(PORT, HOST, () => {
    console.log(`Running on http://${HOST}:${PORT}`);
  });