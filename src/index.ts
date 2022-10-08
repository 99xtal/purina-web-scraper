import puppeteer, { Browser, Page } from 'puppeteer';
import { Cluster } from 'puppeteer-cluster';
import fs from 'fs';

const findLastPageIndex = async (page: Page) => {
  const lastPageHref = await page.$eval('.paginationSkip_last', (n) =>
    n.getAttribute('href')
  );
  if (lastPageHref === null) throw Error("Can't find last breed page index");
  return parseInt(lastPageHref.replace('?page=', ''));
};

const getLinks = async (browser: Browser, breedPageURL: string) => {
  const page = await browser.newPage();
  await page.goto(breedPageURL);
  const uris = await page.$$eval('.callout-bd .link', (n) =>
    n.map((node) => node.getAttribute('href'))
  );
  page.close();
  return uris;
};

const getBreedPageLinks = async (browser: Browser, breedURI: string) => {
  const page = await browser.newPage();
  await page.goto(`http://www.purina.com${breedURI}`);

  const lastPageIndex = await findLastPageIndex(page);

  console.log('Getting URLs for breed pages to scrape...');
  const promises = [];
  for (let i = 0; i <= lastPageIndex; i += 1) {
    promises.push(
      getLinks(browser, `http:///www.purina.com${breedURI}?page=${i}`)
    );
  }
  const breedURIs = await Promise.all(promises);
  const breedLinks = breedURIs
    .flat()
    .map((uri) => `http://www.purina.com${uri}`);
  return breedLinks;
};

const getBreedName = async (page: Page) => {
  return page.$eval('.statsDef-content-list-hd', (n) =>
    n.textContent?.replace('Cat Breed', '').replace('Cat', '').trim()
  );
};

const getBreedAttributes = async (page: Page) => {
  const listItemDivs = await page.$$('.statsDef-content-list-item');
  return Promise.all(
    listItemDivs.map((div) => {
      return Promise.all([
        div.$eval('.statsDef-content-list-item-label', (n) =>
          n.textContent?.toLowerCase().trim()
        ),
        div.$eval('.statsDef-content-list-item-value', (n) =>
          n.textContent?.trim()
        ),
      ]);
    })
  );
};

const getBreedNameAndAttributes = async ({
  page,
  data,
}: {
  page: Page;
  data: { url: string; total: any[] };
}) => {
  await page.goto(data.url);
  const [name, attributeEntries] = await Promise.all([
    getBreedName(page),
    getBreedAttributes(page),
  ]);
  console.log(`--> Got ${name} (${data.url})`);
  page.close();
  data.total.push({
    name: name,
    ...Object.fromEntries(attributeEntries),
  });
  console.log(data.total);
};

const getBreedInfo = async (links: string[]) => {
  console.log('------ Breeds ------');
  console.log(`Getting info for ${links.length} breeds...`);

  const cluster = await Cluster.launch({
    concurrency: Cluster.CONCURRENCY_CONTEXT,
    maxConcurrency: 3,
    monitor: true,
  });

  await cluster.task(getBreedNameAndAttributes);

  const total: Record<string, any>[] = [];

  for (const link of links) {
    cluster.queue({ url: link, total: total });
  }

  await cluster.idle();
  await cluster.close();
  return total;
};

const toBreedCSV = (
  breedArray: Record<string, string>[],
  columnNames: string[]
) => {
  const csvRows = [];
  csvRows.push(columnNames.join(','));
  for (const breed of breedArray) {
    const row = columnNames
      .map((col) => {
        if (breed[col]) {
          return breed[col].includes(',') ? `"${breed[col]}"` : breed[col];
        } else {
          return '';
        }
      })
      .join(',');
    csvRows.push(row);
  }

  return csvRows.join('\n');
};

const getCatBreeds = async (browser: Browser) => {
  console.log('###### CATS ######');
  const catBreedLinks = await getBreedPageLinks(browser, '/cats/cat-breeds');
  const catBreedInfo = await getBreedInfo(catBreedLinks);
  fs.writeFile(
    './data/cat-breeds.json',
    JSON.stringify(catBreedInfo),
    'utf-8',
    (err) => {
      if (err) console.error(err);
      console.log('.cat-breeds.json saved!');
    }
  );
  const csv = toBreedCSV(catBreedInfo, [
    'name',
    'size',
    'weight',
    'coat',
    'color',
  ]);
  fs.writeFileSync('./data/cat-breeds.csv', csv, 'utf-8');
};

const getDogBreeds = async (browser: Browser) => {
  console.log('###### DOGS ######');
  const dogBreedLinks = await getBreedPageLinks(browser, '/dogs/dog-breeds');
  const dogBreedInfo = await getBreedInfo(dogBreedLinks);
  fs.writeFileSync(
    './data/dog-breeds.json',
    JSON.stringify(dogBreedInfo),
    'utf-8'
  );
  const csv = toBreedCSV(dogBreedInfo, [
    'name',
    'size',
    'height',
    'weight',
    'coat',
    'color',
    'energy',
    'activities',
  ]);
  fs.writeFileSync('./data/dog-breeds.csv', csv, 'utf-8');
};

(async () => {
  console.log('Launching headless Chromium browser...');
  const browser = await puppeteer.launch();

  await getCatBreeds(browser);
  await getDogBreeds(browser);
  process.exit();
})();
