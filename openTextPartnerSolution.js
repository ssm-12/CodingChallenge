// Assumptions:
//  It is assumed that fetching partner and solution data via AJAX is acceptable instead of web scraping.
//  It is also assumed that the final JSON should contain all partners, even those without solutions.
//  It is assumed that solutions without a matching partner should also be grouped by PartnerName and included in a separate node.

const axios = require('axios');
const fs = require('fs');

const BASE_URL = 'https://www.opentext.com/en/partners/partners-directory-overview/1716790338234.ajax';
const SOLUTION_BASE_URL = 'https://www.opentext.com/en/partners/ApplicationMarketplace/1754971906819.ajax';
const MAX = 15;
const headers = {
  'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/120.0.0.0 Safari/537.36',
  'Accept': 'application/json, text/plain, */*',
  'Referer': 'https://www.opentext.com/partners/partner-directory'
};

const client = axios.create({ headers });

// Generic paginated fetcher
async function fetchPaginated(baseUrl, { max = MAX, sorter = 'Default_Sort' } = {}, transform) {
  let start = 0;
  let total = Infinity;
  const results = [];

  while (start < total) {
    const url = `${baseUrl}?q=&start=${start}&max=${max}&sorter=${sorter}`;

    try {
      const { data } = await client.get(url);

      if (!data || !data.results || !Array.isArray(data.results.assets)) {
        console.warn(`Unexpected response structure at start=${start}`);
        break;
      }

      const assets = data.results.assets;
      total = data.total ? data.total : 0;

      const items = assets.map(transform).filter(Boolean);
      results.push(...items);

      // console.log(`Fetched ${items.length} items (start=${start})`);
      start += max;
    } catch (err) {
      console.error(`Error fetching data at start=${start}:`, err.message || err);
      break;
    }
  }

  return results;
}

function partnerTransform(asset) {
  return asset.contentJson?.Partners?.PartnerDisplay?.Name ?? null;
}

function solutionTransform(asset) {
  const display = asset.contentJson?.Solutions?.Solution;
  return display?.solutionname && display?.solutionpartnername
    ? { solutionName: display.solutionname, solutionPartnerName: display.solutionpartnername }
    : null;
}

function normalizeName(n) {
  return (n || '').toString().trim().toLowerCase();
}

async function main() {
  try {
    const partners = await fetchPaginated(BASE_URL, { max: MAX, sorter: 'Default_Sort' }, partnerTransform);
    const solutions = await fetchPaginated(SOLUTION_BASE_URL, { max: MAX, sorter: 'Name' }, solutionTransform);

    // map partners by normalized name
    const partnerMap = new Map();
    for (const p of partners) {
      const key = normalizeName(p);
      if (!partnerMap.has(key)) {
        partnerMap.set(key, { partnerName: p, solutions: [] });
      }
    }

    // attach solutions to matching partner, collect unmatched grouped by solutionPartnerName
    const unmatchedMap = new Map();

    for (const s of solutions) {
      const key = normalizeName(s.solutionPartnerName);
      const entry = partnerMap.get(key);
      if (entry) {
        entry.solutions.push({ solutionName: s.solutionName });
      } else {
        const partnerNameOriginal = (s.solutionPartnerName || '').toString().trim();
        if (!unmatchedMap.has(partnerNameOriginal)) unmatchedMap.set(partnerNameOriginal, []);
        unmatchedMap.get(partnerNameOriginal).push({ solutionName: s.solutionName });
      }
    }

    // convert unmatchedMap to an array of grouped objects
    const unmatched = Array.from(unmatchedMap.entries())
      .map(([solutionPartnerName, solutions]) => ({ solutionPartnerName, solutions }))
      .sort((a, b) => a.solutionPartnerName.localeCompare(b.solutionPartnerName));

    // ensure all partners included (even those without solutions)
    const joined = Array.from(partnerMap.values()).sort((a, b) => a.partnerName.localeCompare(b.partnerName));

    const output = { partners: joined, unmatchedSolutionsGroupedByPartner: unmatched };
    const outPath = 'partners_solutions.json';
    fs.writeFileSync(outPath, JSON.stringify(output, null, 2), 'utf8');

    console.log(`\nTotal partners fetched: ${partners.length}`);
    console.log(`Total solutions fetched: ${solutions.length}`);
    console.log(`Final JSON containing solutions grouped by parter name is saved to ${outPath}`);
  } catch (err) {
    console.error('Unexpected error:', err);
  }
}

main();