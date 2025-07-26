const puppeteer = require('puppeteer');

// Custom timeout function
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));

// In-memory lock
let isRunning = false;

const testAdRendering = async () => {
  console.log('Starting testAdRendering');
  if (isRunning) {
    console.log('Skipping cycle, another instance or previous run is in progress');
    return;
  }
  isRunning = true;

  let browser;
  try {
    console.log('Launching browser...');
    browser = await puppeteer.launch({
      headless: true,
      args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage', '--disable-web-security'],
      executablePath: require('puppeteer').executablePath(),
    });
    console.log('Browser launched successfully');
    const page = await browser.newPage();

    await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36');
    await page.setViewport({ width: 1280, height: 4000 });

    page.on('error', err => console.error('Page error:', err.message));
    page.on('pageerror', err => console.error('Page JavaScript error:', err.message));

    let navAttempts = 0;
    const maxAttempts = 3;
    let navSuccess = false;
    while (navAttempts < maxAttempts && !navSuccess) {
      try {
        console.log('Navigating to page...');
        await page.goto('https://client-anis-portfolio.vercel.app', { waitUntil: 'networkidle2', timeout: 10000 });
        navSuccess = true;
        console.log('Navigation successful');
      } catch (navError) {
        navAttempts++;
        console.warn(`Navigation attempt ${navAttempts} failed: ${navError.message}`);
        if (navAttempts === maxAttempts) {
          console.error('All navigation attempts failed');
          return {
            adContainersFound: 0,
            clickAttempted: false,
            clickSuccessful: false,
            error: `Navigation failed after ${maxAttempts} attempts: ${navError.message}`
          };
        }
        await delay(500);
      }
    }

    await page.evaluate(() => {
      window.scrollTo(0, document.body.scrollHeight / 2); // Simplified to one scroll
    });
    await page.mouse.move(500, 500);
    await page.mouse.move(600, 600);
    await page.mouse.click(600, 600);
    await delay(500);

    const scrollResult = await page.evaluate(() => {
      const footer = document.querySelector('footer') || document.querySelector('[class*="footer"]');
      let footerInfo = { found: false, bottom: 0, html: '' };
      if (footer) {
        footerInfo = {
          found: true,
          bottom: footer.getBoundingClientRect().bottom + window.scrollY,
          html: footer.outerHTML.slice(0, 200)
        };
      } else {
        console.warn('No footer found, using document bottom');
        footerInfo.bottom = document.body.scrollHeight;
      }
      return footerInfo;
    });

    await delay(500);

    const belowFooterElements = await page.evaluate((footerBottom) => {
      const maxDistance = 1000; // Reduced from 2000
      const step = 5;
      let elements = [];
      for (let offset = 0; offset <= maxDistance; offset += step) {
        const currentTop = footerBottom + offset;
        const foundElements = Array.from(document.querySelectorAll('*')).filter(el => {
          const rect = el.getBoundingClientRect();
          const elTop = rect.top + window.scrollY;
          return elTop >= currentTop && elTop < currentTop + step && rect.height > 0 && rect.width > 0;
        });
        elements.push(...foundElements.map(el => ({
          id: el.id || 'No ID',
          className: typeof el.className === 'string' ? el.className : 'Invalid className',
          tagName: el.tagName,
          top: el.getBoundingClientRect().top + window.scrollY,
          html: el.outerHTML.slice(0, 200)
        })));
      }
      return elements;
    }, scrollResult.bottom);

    const adInteraction = await page.evaluate((footerBottom) => {
      const adElements = Array.from(document.querySelectorAll(
        '[data-ad-slot], .adsbygoogle, ins, [id*="ad"], [class*="ad"], .ad-unit, [class*="advert"], [class*="banner"], iframe, a'
      )).filter(ad => {
        const rect = ad.getBoundingClientRect();
        const adTop = rect.top + window.scrollY;
        return adTop > footerBottom && adTop < footerBottom + 1000 && rect.height > 0 && rect.width > 0 &&
               window.getComputedStyle(ad).display !== 'none' && window.getComputedStyle(ad).visibility !== 'hidden';
      });

      if (adElements.length === 0) {
        const adContainer = document.querySelector('#ad-container');
        if (adContainer) {
          const containerAdElements = adContainer.querySelectorAll('ins, iframe, [data-ad-slot], .adsbygoogle, [class*="ad"], [class*="advert"], [class*="banner"], a, div');
          const visibleAd = Array.from(containerAdElements).find(ad => {
            const rect = ad.getBoundingClientRect();
            return rect.top >= 0 && rect.bottom <= window.innerHeight && rect.height > 0 && rect.width > 0 &&
                   window.getComputedStyle(ad).display !== 'none' && window.getComputedStyle(ad).visibility !== 'hidden';
          });
          if (!visibleAd) {
            return {
              adContainersFound: 1,
              clickAttempted: false,
              clickSuccessful: false,
              error: 'No visible ad elements found in ad-container'
            };
          }
          try {
            const adId = visibleAd.id || 'No ID';
            const adClass = typeof visibleAd.className === 'string' ? visibleAd.className : 'No Class';
            const adDataSlot = visibleAd.getAttribute('data-ad-slot') || 'No Data Slot';
            const adPosition = visibleAd.getBoundingClientRect().top + window.scrollY;
            window.scrollTo(0, adPosition - 100);
            visibleAd.click();
            return {
              adContainersFound: 1,
              clickAttempted: true,
              clickSuccessful: true,
              adPosition,
              adId,
              adClass,
              adDataSlot
            };
          } catch (error) {
            return {
              adContainersFound: 1,
              clickAttempted: true,
              clickSuccessful: false,
              error: `Click failed: ${error.message}`
            };
          }
        }
        return {
          adContainersFound: 0,
          clickAttempted: false,
          clickSuccessful: false,
          error: 'No ad elements found below footer or in ad-container'
        };
      }

      try {
        const ad = adElements[0];
        const adId = ad.id || 'No ID';
        const adClass = typeof ad.className === 'string' ? ad.className : 'No Class';
        const adDataSlot = ad.getAttribute('data-ad-slot') || 'No Data Slot';
        const adPosition = ad.getBoundingClientRect().top + window.scrollY;
        window.scrollTo(0, adPosition - 100);
        ad.click();
        return {
          adContainersFound: adElements.length,
          clickAttempted: true,
          clickSuccessful: true,
          adPosition,
          adId,
          adClass,
          adDataSlot
        };
      } catch (error) {
        return {
          adContainersFound: adElements.length,
          clickAttempted: true,
          clickSuccessful: false,
          error: `Click failed: ${error.message}`
        };
      }
    }, scrollResult.bottom);

    const iframeAdInteraction = await page.evaluate((footerBottom) => {
      const iframes = Array.from(document.querySelectorAll('iframe')).filter(iframe => {
        const rect = iframe.getBoundingClientRect();
        const iframeTop = rect.top + window.scrollY;
        return iframeTop > footerBottom && iframeTop < footerBottom + 1000;
      });
      for (const iframe of iframes) {
        try {
          if (iframe.contentDocument && (iframe.src !== 'about:blank' || iframe.contentDocument.body.children.length > 0)) {
            const ad = iframe.contentDocument.querySelector(
              '[data-ad-slot], .adsbygoogle, ins, [id*="ad"], [class*="ad"], .ad-unit, [class*="advert"], [class*="banner"], a'
            );
            if (ad) {
              const rect = ad.getBoundingClientRect();
              if (rect.top >= 0 && rect.bottom <= window.innerHeight && rect.height > 0 && rect.width > 0 &&
                  window.getComputedStyle(ad).display !== 'none' && window.getComputedStyle(ad).visibility !== 'hidden') {
                ad.click();
                return {
                  adContainersFound: 1,
                  clickAttempted: true,
                  clickSuccessful: true,
                  adPosition: rect.top + window.scrollY,
                  adId: ad.id || 'No ID',
                  adClass: typeof ad.className === 'string' ? ad.className : 'No Class',
                  adDataSlot: ad.getAttribute('data-ad-slot') || 'No Data Slot',
                  inIframe: true
                };
              }
            }
          }
        } catch (e) {
          console.warn('Iframe access error:', e.message);
        }
      }
      return null;
    }, scrollResult.bottom);

    const timestamp = new Date().toLocaleString('en-PK', { timeZone: 'Asia/Karachi' });
    console.log(`Footer Info at ${timestamp}:`, {
      footerFound: scrollResult.found,
      footerBottom: scrollResult.bottom,
      footerHtml: scrollResult.html
    });
    if (iframeAdInteraction?.clickSuccessful) {
      console.log(`Iframe Ad Clicked at ${timestamp}:`, iframeAdInteraction);
    } else if (adInteraction.clickSuccessful) {
      console.log(`Ad Clicked at ${timestamp}:`, adInteraction);
    } else {
      console.log(`Ad Interaction Failed at ${timestamp}:`, adInteraction);
    }
    console.log(`Cycle completed at ${timestamp}`);

    return iframeAdInteraction || adInteraction;
  } catch (error) {
    const timestamp = new Date().toLocaleString('en-PK', { timeZone: 'Asia/Karachi' });
    console.error(`Error at ${timestamp}:`, error.message);
    return {
      adContainersFound: 0,
      clickAttempted: false,
      clickSuccessful: false,
      error: error.message
    };
  } finally {
    if (browser) await browser.close();
    isRunning = false;
  }
};

// Local testing
console.log('Script started at', new Date().toLocaleString('en-PK', { timeZone: 'Asia/Karachi' }));
testAdRendering().then(result => console.log('Test completed at', new Date().toLocaleString('en-PK', { timeZone: 'Asia/Karachi' }), 'with result:', result));
let intervalId = setInterval(testAdRendering, 60000);

// Vercel export (uncomment and remove local testing for deployment)
module.exports = async (req, res) => {
  const result = await testAdRendering();
  res.status(200).json({ status: 'success', result });
};