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
      const browser = await chromium.launch({ headless: true }); // Cambia a true si quieres usar modo headless
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

    // Extraer el H1
    const h1 = await page.$eval('h1', el => el.textContent.trim());
            
    // Extraer el contenido de la meta description
    const metaDescription = await page.$eval('meta[name="description"]', el => el.getAttribute('content'));
    
    // Agregar los datos al array
    const data = { 'page': url, 'title': h1, 'description': metaDescription };
    await browser.close();
    return data

}

app.listen(PORT, HOST, () => {
    console.log(`Running on http://${HOST}:${PORT}`);
  });