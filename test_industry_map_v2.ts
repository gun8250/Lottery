
import axios from "axios";

async function fetchIndustryMap() {
  const industryMap: Record<string, string> = {};
  try {
    console.log("Fetching industry mapping from Eastmoney in small batches...");
    const batchSize = 100;
    const maxPages = 60; // 60 * 100 = 6000 stocks
    for (let page = 1; page <= maxPages; page++) {
      let retries = 5;
      let success = false;
      while (retries > 0 && !success) {
        try {
          const url = `https://push2.eastmoney.com/api/qt/clist/get?pn=${page}&pz=${batchSize}&po=1&np=1&ut=bd1d9ddb040897f352c29ee4f395b3e2&fltt=2&invt=2&fid=f3&fs=m:0+t:6,m:0+t:80,m:1+t:2,m:1+t:23&fields=f12,f100`;
          const res = await axios.get(url, {
            headers: {
              "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
              "Referer": "https://quote.eastmoney.com/center/gridlist.html"
            },
            timeout: 20000
          });

          if (res.data && res.data.data && res.data.data.diff) {
            const stocks = res.data.data.diff;
            if (stocks.length === 0) {
              success = true;
              break;
            }
            stocks.forEach((s: any) => {
              if (s.f12 && s.f100 && s.f100 !== "-") {
                industryMap[s.f12] = s.f100;
              }
            });
            if (page % 10 === 0) console.log(`Fetched page ${page}...`);
            success = true;
          } else {
            retries--;
          }
        } catch (e: any) {
          retries--;
          console.warn(`Retry ${5 - retries} for page ${page} failed: ${e.message}`);
          await new Promise(resolve => setTimeout(resolve, 2000));
        }
      }
      if (!success) console.warn(`Failed to fetch page ${page} after retries.`);
      await new Promise(resolve => setTimeout(resolve, 1000));
    }
    console.log(`Industry mapping built for ${Object.keys(industryMap).length} stocks using Eastmoney.`);
  } catch (error: any) {
    console.error("Failed to fetch industry map from Eastmoney:", error.message);
  }
  return industryMap;
}

fetchIndustryMap().then(map => {
  console.log("Sample 300750:", map['300750']);
  console.log("Sample 600111:", map['600111']);
});
