// Assumptions:
//  It is assumed that fetching partner and solution data via AJAX is acceptable instead of web scraping.
//  It is also assumed that the final JSON should contain all partners, even those without solutions.
//  It is assumed that solutions without a matching partner should also be grouped by partner and included in a separate node in the same json.
//  It is assumed that partner "Id" field should be used to link solutions to partners.

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

      start += max;
    } catch (err) {
      console.error(`Error fetching data at start=${start}:`, err.message || err);
      break;
    }
  }

  return results;
}

// Use Id for partners (exact key "Id") and "solutionpartner" for solutions
function partnerTransform(asset) {
  const pd = asset.contentJson?.Partners?.Partner;
  if (!pd) return null;
  return {
    id: pd.Id ?? null,
    partnerName: pd.Name ?? null
  };
}

function solutionTransform(asset) {
  const s = asset.contentJson?.Solutions?.Solution;
  if (!s) return null;
  return {
    solutionId: s.solutionid ?? null,
    solutionName: s.solutionname ?? null,
    partnerId: s.solutionpartner ?? null,
    partnerName: s.solutionpartnername ?? null
  };
}

async function main() {
  try {
    const partners = await fetchPaginated(BASE_URL, { max: MAX, sorter: 'Default_Sort' }, partnerTransform);
    const solutions = await fetchPaginated(SOLUTION_BASE_URL, { max: MAX, sorter: 'Name' }, solutionTransform);

    // Map partners by Id (stringified). Keep partners without Id as well.
    const partnerMap = new Map();
    const noIdPartners = [];

    for (const p of partners) {
      if (p.id != null) {
        partnerMap.set(String(p.id), { id: p.id, partnerName: p.partnerName ?? null, solutions: [] });
      } else {
        noIdPartners.push({ id: null, partnerName: p.partnerName ?? null, solutions: [] });
      }
    }

    // Attach solutions by partnerId. Group unmatched solutions by partnerId value (solutionpartner).
    const unmatchedMap = new Map(); // key = String(partnerId) (could be 'null' for missing)

    for (const s of solutions) {
      const pidKey = s.partnerId != null ? String(s.partnerId) : 'null';
      const sol = { solutionId: s.solutionId, solutionName: s.solutionName };

      if (s.partnerId != null && partnerMap.has(pidKey)) {
        partnerMap.get(pidKey).solutions.push(sol);
      } else {
        // Use partnerName from solution (solutionpartnername) when partnerId not found
        const partnerNameFromSolution = s.partnerName ?? null;
        if (!unmatchedMap.has(pidKey)) {
          unmatchedMap.set(pidKey, { partnerId: s.partnerId ?? null, partnerName: partnerNameFromSolution, solutions: [] });
        }
        // Ensure partnerName is set if it was previously null
        const entry = unmatchedMap.get(pidKey);
        if (!entry.partnerName && partnerNameFromSolution) entry.partnerName = partnerNameFromSolution;
        entry.solutions.push(sol);
      }
    }

    // Prepare output arrays
    const joined = Array.from(partnerMap.values())
      .concat(noIdPartners)
      .sort((a, b) => (a.partnerName || '').localeCompare(b.partnerName || ''));

    const unmatched = Array.from(unmatchedMap.values()).sort((a, b) => {
      const an = a.partnerId != null ? String(a.partnerId) : '';
      const bn = b.partnerId != null ? String(b.partnerId) : '';
      return an.localeCompare(bn);
    });

    const output = { partners: joined, unmatchedSolutionsGroupedByPartnerId: unmatched };
    const outPath = 'partners_solutions_withId.json';
    fs.writeFileSync(outPath, JSON.stringify(output, null, 2), 'utf8');

    console.log(`Total partners fetched: ${partners.length}`);
    console.log(`Total solutions fetched: ${solutions.length}`);
    console.log(`Final JSON containing solutions grouped by parter name is saved to ${outPath}`);
  } catch (err) {
    console.error('Unexpected error:', err);
  }
}

main();