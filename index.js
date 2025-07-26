const puppeteer = require('puppeteer');
const fs = require('fs');

// Custom timeout function
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));

// Single-instance lock
const lockFile = 'bot.lock';
let isRunning = false;

const testAdRendering = async () => {
  if (isRunning || fs.existsSync(lockFile)) {
    console.log('Skipping cycle, another instance or previous run is in progress');
    return;
  }
  isRunning = true;
  fs.writeFileSync(lockFile, 'running');

  let browser;
  try {
    browser = await puppeteer.launch({ 
      headless: true,
      args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage', '--disable-web-security']
    });
    const page = await browser.newPage();

    // Set user-agent to mimic real browser
    await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36');

    // Set viewport to capture full page
    await page.setViewport({ width: 1280, height: 4000 });

    // Handle errors
    page.on('error', err => console.error('Page error:', err.message));
    page.on('pageerror', err => console.error('Page JavaScript error:', err.message));

    // Navigate with retry
    let navAttempts = 0;
    const maxAttempts = 3;
    let navSuccess = false;
    while (navAttempts < maxAttempts && !navSuccess) {
      try {
        await page.goto('https://client-anis-portfolio.vercel.app', { 
          waitUntil: 'networkidle2',
          timeout: 45000 
        });
        navSuccess = true;
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
        await delay(5000);
      }
    }

    // Simulate extensive human-like interaction
    await page.evaluate(() => {
      window.scrollTo(0, document.body.scrollHeight);
      window.scrollTo(0, 0);
      window.scrollTo(0, document.body.scrollHeight / 2);
      window.scrollTo(0, 9000); // Near current footer
      window.scrollTo(0, 10000);
      window.scrollTo(0, 11000);
    });
    await page.mouse.move(500, 500);
    await page.mouse.move(600, 600);
    await page.mouse.click(600, 600);
    await page.mouse.move(700, 700);
    await delay(10000);

    // Get footer info
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

    // Wait for ad loading
    await delay(90000);

    // Save full-page screenshot and HTML for debugging
    await page.screenshot({ path: 'full-page-screenshot.png', fullPage: true });
    const pageHtml = await page.evaluate(() => document.documentElement.outerHTML);
    fs.writeFileSync('page.html', pageHtml);

    // Collect ad-container specifically
    const adContainerInfo = await page.evaluate(() => {
      const adContainer = document.querySelector('#ad-container');
      if (!adContainer) {
        return {
          found: false,
          details: null,
          children: []
        };
      }
      const children = Array.from(adContainer.querySelectorAll('ins, iframe, [data-ad-slot], .adsbygoogle, [class*="ad"], [class*="advert"], [class*="banner"], a, div'));
      return {
        found: true,
        details: {
          id: adContainer.id || 'No ID',
          className: typeof adContainer.className === 'string' ? adContainer.className : 'Invalid className',
          tagName: adContainer.tagName,
          top: adContainer.getBoundingClientRect().top + window.scrollY,
          html: adContainer.outerHTML.slice(0, 2000)
        },
        children: children.map(child => ({
          id: child.id || 'No ID',
          className: typeof child.className === 'string' ? child.className : 'Invalid className',
          tagName: child.tagName,
          top: child.getBoundingClientRect().top + window.scrollY,
          html: child.outerHTML.slice(0, 500)
        }))
      };
    });

    console.log('Ad Container Info:', JSON.stringify(adContainerInfo, null, 2));

    // Collect all potential ad containers site-wide
    const allAdContainersInfo = await page.evaluate(() => {
      const adContainers = Array.from(document.querySelectorAll(
        '[data-ad-slot], .adsbygoogle, ins, [id*="ad"], [class*="ad"], .ad-unit, [class*="advert"], [class*="banner"]'
      )).filter(ad => {
        const className = typeof ad.className === 'string' ? ad.className.toLowerCase() : '';
        return className && 
               !className.includes('nav') && 
               !className.includes('fixed') && 
               !className.includes('top-0') && 
               !className.includes('header') && 
               !className.includes('font-mono') && 
               !className.includes('bg-gradient') && 
               !className.includes('skill-item') && 
               !className.includes('text-gray') && 
               !className.includes('shadow-md') && 
               !className.includes('backdrop-blur');
      });
      return {
        adContainersFound: adContainers.length,
        adDetails: adContainers.map(ad => ({
          id: ad.id || 'No ID',
          className: typeof ad.className === 'string' ? ad.className : 'Invalid className',
          tagName: ad.tagName,
          top: ad.getBoundingClientRect().top + window.scrollY,
          html: ad.outerHTML.slice(0, 500)
        }))
      };
    });

    console.log('Filtered Ad Containers:', JSON.stringify(allAdContainersInfo.adDetails, null, 2));

    // Collect elements in 5-pixel increments below footer (extended to 2000px)
    const belowFooterElements = await page.evaluate((footerBottom) => {
      const maxDistance = 2000; // Extended to 2000px below footer
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

    console.log('Elements Below Footer (5px increments up to 2000px):', JSON.stringify(belowFooterElements, null, 2));

    // Attempt to click ads below footer
    const adInteraction = await page.evaluate((footerBottom) => {
      const adElements = Array.from(document.querySelectorAll(
        '[data-ad-slot], .adsbygoogle, ins, [id*="ad"], [class*="ad"], .ad-unit, [class*="advert"], [class*="banner"], iframe, a'
      )).filter(ad => {
        const rect = ad.getBoundingClientRect();
        const adTop = rect.top + window.scrollY;
        return adTop > footerBottom && 
               adTop < footerBottom + 2000 && 
               rect.height > 0 && 
               rect.width > 0 && 
               window.getComputedStyle(ad).display !== 'none' && 
               window.getComputedStyle(ad).visibility !== 'hidden';
      });

      if (adElements.length === 0) {
        const adContainer = document.querySelector('#ad-container');
        if (adContainer) {
          const containerAdElements = adContainer.querySelectorAll('ins, iframe, [data-ad-slot], .adsbygoogle, [class*="ad"], [class*="advert"], [class*="banner"], a, div');
          const visibleAd = Array.from(containerAdElements).find(ad => {
            const rect = ad.getBoundingClientRect();
            return rect.top >= 0 && 
                   rect.bottom <= window.innerHeight && 
                   rect.height > 0 && 
                   rect.width > 0 && 
                   window.getComputedStyle(ad).display !== 'none' && 
                   window.getComputedStyle(ad).visibility !== 'hidden';
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
        const ad = adElements[0]; // Click the first ad below footer
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

    // Check iframe ads with content loading
    const iframeAdInteraction = await page.evaluate((footerBottom) => {
      const iframes = Array.from(document.querySelectorAll('iframe')).filter(iframe => {
        const rect = iframe.getBoundingClientRect();
        const iframeTop = rect.top + window.scrollY;
        return iframeTop > footerBottom && iframeTop < footerBottom + 2000;
      });
      for (const iframe of iframes) {
        try {
          if (iframe.contentDocument && (iframe.src !== 'about:blank' || iframe.contentDocument.body.children.length > 0)) {
            const ad = iframe.contentDocument.querySelector(
              '[data-ad-slot], .adsbygoogle, ins, [id*="ad"], [class*="ad"], .ad-unit, [class*="advert"], [class*="banner"], a'
            );
            if (ad) {
              const rect = ad.getBoundingClientRect();
              if (rect.top >= 0 && 
                  rect.bottom <= window.innerHeight && 
                  rect.height > 0 && 
                  rect.width > 0 && 
                  window.getComputedStyle(ad).display !== 'none' && 
                  window.getComputedStyle(ad).visibility !== 'hidden') {
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

    // Log results
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
    if (fs.existsSync(lockFile)) fs.unlinkSync(lockFile);
  }
};

// Clear existing intervals and lock
let intervalId = null;
if (intervalId) clearInterval(intervalId);
if (fs.existsSync(lockFile)) fs.unlinkSync(lockFile);

// Run every 60 seconds
intervalId = setInterval(async () => {
  const timestamp = new Date().toLocaleString('en-PK', { timeZone: 'Asia/Karachi' });
  console.log('Starting new ad check cycle:', timestamp);
  await testAdRendering();
}, 60000);