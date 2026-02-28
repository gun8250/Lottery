import express from "express";
import { createServer as createViteServer } from "vite";
import axios from "axios";
import iconv from "iconv-lite";
import dotenv from "dotenv";
import path from "path";
import fs from "fs";
import { fileURLToPath } from "url";
import Database from "better-sqlite3";
import http from "http";
import https from "https";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

dotenv.config();

const app = express();
const PORT = Number(process.env.PORT) || 3000;

// Force IPv4 for external requests to avoid socket hang up issues
const httpAgent = new http.Agent({ family: 4 });
const httpsAgent = new https.Agent({ family: 4 });

// Database Setup
const dbPath = process.env.NODE_ENV === "production" ? "/tmp/stocks.db" : "stocks.db";
const schemaSql = `
  CREATE TABLE IF NOT EXISTS scan_status (
    id INTEGER PRIMARY KEY,
    last_scan_time TEXT,
    is_scanning INTEGER DEFAULT 0,
    progress_current INTEGER DEFAULT 0,
    progress_total INTEGER DEFAULT 0
  );
  CREATE TABLE IF NOT EXISTS filtered_stocks (
    strategy TEXT,
    symbol TEXT,
    industry TEXT,
    data TEXT,
    PRIMARY KEY (strategy, symbol)
  );
  INSERT OR IGNORE INTO scan_status (id, last_scan_time, is_scanning, progress_current, progress_total) VALUES (1, NULL, 0, 0, 0);
`;

function createDatabase(filePath: string) {
  const database = new Database(filePath);
  database.exec(schemaSql);
  return database;
}

function initDatabase(filePath: string) {
  try {
    return createDatabase(filePath);
  } catch (error: any) {
    if (error?.code === "SQLITE_CORRUPT" && filePath !== ":memory:") {
      let newDbPath = filePath;
      const backupPath = `${filePath}.corrupt.${Date.now()}`;
      try {
        if (fs.existsSync(filePath)) {
          fs.renameSync(filePath, backupPath);
          console.warn(`Corrupted database moved to: ${backupPath}`);
        }
      } catch (renameError: any) {
        const parsed = path.parse(filePath);
        newDbPath = path.join(parsed.dir, `${parsed.name}.runtime.${Date.now()}${parsed.ext || ".db"}`);
        console.warn(`Failed to move corrupted database (${renameError.code}). Using a new database: ${newDbPath}`);
      }
      console.warn("Recreating database due to SQLITE_CORRUPT...");
      return createDatabase(newDbPath);
    }
    throw error;
  }
}

const db = initDatabase(dbPath);

app.use(express.json());

/**
 * Eastmoney API Helper
 * AKShare often wraps these sources.
 */
async function fetchEastmoneyData(url: string) {
  try {
    // Revert to https and use a longer timeout
    const response = await axios.get(url, {
      timeout: 10000,
      headers: {
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
        "Referer": "https://quote.eastmoney.com/center/gridlist.html"
      },
      httpAgent,
      httpsAgent
    });
    return response.data;
  } catch (error: any) {
    console.error(`Eastmoney API Error:`, error.message);
    return null;
  }
}

async function fetchSinaData(url: string) {
  try {
    const response = await axios.get(url, {
      timeout: 5000,
      headers: {
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
        "Referer": "http://finance.sina.com.cn/stock/quotes/center/hsa.shtml"
      },
      httpAgent,
      httpsAgent
    });
    return response.data;
  } catch (error: any) {
    console.error(`Sina API Error:`, error.message);
    return null;
  }
}

// Calculate KDJ
function calculateKDJ(data: any[], n = 9, m1 = 3, m2 = 3) {
  if (data.length < n) return null;

  let k = 50;
  let d = 50;
  const results = [];

  for (let i = 0; i < data.length; i++) {
    const close = parseFloat(data[i].close);
    const low = parseFloat(data[i].low);
    const high = parseFloat(data[i].high);

    if (i < n - 1) {
      results.push({ k: 50, d: 50, j: 50 });
      continue;
    }

    const slice = data.slice(i - n + 1, i + 1);
    const lowN = Math.min(...slice.map(d => parseFloat(d.low)));
    const highN = Math.max(...slice.map(d => parseFloat(d.high)));

    const rsv = highN === lowN ? 50 : ((close - lowN) / (highN - lowN)) * 100;
    k = ( (m1 - 1) * k + rsv ) / m1;
    d = ( (m2 - 1) * d + k ) / m2;
    const j = 3 * k - 2 * d;

    results.push({ k, d, j });
  }
  return results;
}

// Calculate MA
function calculateMA(data: any[], period: number) {
  const results = [];
  for (let i = 0; i < data.length; i++) {
    if (i < period - 1) {
      results.push(null);
      continue;
    }
    const sum = data.slice(i - period + 1, i + 1).reduce((acc, curr) => acc + curr.close, 0);
    results.push(sum / period);
  }
  return results;
}

// Calculate BBI
function calculateBBI(data: any[]) {
  const ma3 = calculateMA(data, 3);
  const ma6 = calculateMA(data, 6);
  const ma12 = calculateMA(data, 12);
  const ma24 = calculateMA(data, 24);
  
  const results = [];
  for (let i = 0; i < data.length; i++) {
    if (ma24[i] === null || ma12[i] === null || ma6[i] === null || ma3[i] === null) {
      results.push(null);
      continue;
    }
    results.push((ma3[i]! + ma6[i]! + ma12[i]! + ma24[i]!) / 4);
  }
  return results;
}

// Calculate EMA
function calculateEMA(data: any[], period: number) {
  const k = 2 / (period + 1);
  const results = [];
  if (data.length === 0) return results;
  let ema = data[0].close;
  results.push(ema);
  for (let i = 1; i < data.length; i++) {
    ema = (data[i].close - ema) * k + ema;
    results.push(ema);
  }
  return results;
}

// Calculate DIF
function calculateDIF(data: any[]) {
  const ema12 = calculateEMA(data, 12);
  const ema26 = calculateEMA(data, 26);
  const results = [];
  for (let i = 0; i < data.length; i++) {
    results.push(ema12[i] - ema26[i]);
  }
  return results;
}

// Helper for N-Pattern
function getAvgVol(data: any[], index: number, period: number) {
  const start = Math.max(0, index - period);
  if (start === index) return data[index].vol;
  let sum = 0;
  let count = 0;
  for (let i = start; i < index; i++) {
    sum += data[i].vol;
    count++;
  }
  return sum / count;
}

function checkNPattern(klines: any[]) {
  if (klines.length < 90) return false;
  const data = klines.slice(-90);
  const n = data.length;

  // 1. Calculate MAs for trend filter
  const ma20 = calculateMA(klines, 20);
  const ma60 = calculateMA(klines, 60);
  const dif = calculateDIF(klines);
  
  const lastIdx = klines.length - 1;
  const currentPrice = klines[lastIdx].close;
  
  // Trend Filter: Price above MA20 and MA60, DIF > 0
  if (currentPrice < ma20[lastIdx]! || currentPrice < ma60[lastIdx]! || dif[lastIdx] <= 0) {
    return false;
  }

  // 2. Find local extrema (peaks and troughs)
  const peaks: { idx: number, price: number, vol: number }[] = [];
  const troughs: { idx: number, price: number, vol: number }[] = [];
  const window = 4; // Slightly larger window for more significant points

  for (let i = window; i < n - window; i++) {
    const currentHigh = data[i].high;
    const currentLow = data[i].low;
    let isPeak = true;
    let isTrough = true;
    for (let j = i - window; j <= i + window; j++) {
      if (i === j) continue;
      if (data[j].high > currentHigh) isPeak = false;
      if (data[j].low < currentLow) isTrough = false;
    }
    if (isPeak) peaks.push({ idx: i, price: currentHigh, vol: data[i].vol });
    if (isTrough) troughs.push({ idx: i, price: currentLow, vol: data[i].vol });
  }

  // 3. Search for A(trough) -> B(peak) -> C(trough) -> D(peak)
  const avgVolTotal = data.reduce((acc, curr) => acc + curr.vol, 0) / n;

  for (let iD = peaks.length - 1; iD >= 0; iD--) {
    const D = peaks[iD];
    if (D.idx < n - 15) continue; // D must be very recent

    for (let iC = troughs.length - 1; iC >= 0; iC--) {
      const C = troughs[iC];
      if (C.idx >= D.idx - 4) continue; // Min interval 5 days
      if (C.idx < 15) continue;

      for (let iB = peaks.length - 1; iB >= 0; iB--) {
        const B = peaks[iB];
        if (B.idx >= C.idx - 4) continue;
        if (B.idx < 10) continue;

        for (let iA = troughs.length - 1; iA >= 0; iA--) {
          const A = troughs[iA];
          if (A.idx >= B.idx - 4) continue;

          // Price constraints: A < C < B < D
          // Strict: C > A * 1.03 (Higher Low), D > B * 1.03 (Clear Breakout)
          if (C.price > A.price * 1.03 && B.price > C.price && D.price > B.price * 1.03) {
            
            const riseAB = B.price - A.price;
            const fallBC = B.price - C.price;
            const riseCD = D.price - C.price;

            // Significant first leg: B-A >= 10%
            if (riseAB >= A.price * 0.10) {
              // Retracement constraint: B->C is 20% to 50% of A->B
              const retracementRatio = fallBC / riseAB;
              if (retracementRatio >= 0.2 && retracementRatio <= 0.5) {
                
                // Volume analysis:
                // B and D should be high volume (breakouts)
                // C should be low volume (pullback)
                const isVolBHigh = B.vol > avgVolTotal * 1.3;
                const isVolDHigh = D.vol > avgVolTotal * 1.3;
                const isVolCLow = C.vol < avgVolTotal * 1.1;

                if (isVolBHigh && isVolDHigh && isVolCLow) {
                  // Final check: current price is holding above C and near D
                  if (currentPrice >= C.price && currentPrice >= D.price * 0.9) {
                    return true;
                  }
                }
              }
            }
          }
        }
      }
    }
  }
  return false;
}

app.get("/api/debug/test-shao-fu", async (req, res) => {
  try {
    const symbol = "603833";
    const market = 1; // SH
    const klines = await fetchTencentHistory(symbol, market);
    if (!klines) return res.json({ error: "No klines" });

    const kdjValues = calculateKDJ(klines);
    const lastKDJ = kdjValues![kdjValues!.length - 1];

    const last60 = klines.slice(-60);
    const high60 = Math.max(...last60.map(d => d.high));
    const low60 = Math.min(...last60.map(d => d.low));
    const volatility = (high60 - low60) / low60;
    const volMatch = volatility <= 1.0;

    const bbiValues = calculateBBI(klines);
    const todayBBI = bbiValues[bbiValues.length - 1];
    const yesterdayBBI = bbiValues[bbiValues.length - 2];
    const bbiRising = todayBBI !== null && yesterdayBBI !== null && todayBBI > yesterdayBBI;

    const jValueMatch = lastKDJ.j < -1;

    const difValues = calculateDIF(klines);
    const todayDIF = difValues[difValues.length - 1];
    const difMatch = todayDIF > 0;

    res.json({
      symbol,
      volatility,
      volMatch,
      todayBBI,
      yesterdayBBI,
      bbiRising,
      jValue: lastKDJ.j,
      jValueMatch,
      todayDIF,
      difMatch,
      matched: volMatch && bbiRising && jValueMatch && difMatch
    });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

async function fetchTencentHistory(symbol: string, market: number, retries = 1) {
  try {
    let prefix = "";
    if (market === 1) prefix = "sh";
    else if (market === 0) {
      if (symbol.startsWith('4') || symbol.startsWith('8') || symbol.startsWith('9')) {
        prefix = "bj";
      } else {
        prefix = "sz";
      }
    }
    
    const url = `https://web.ifzq.gtimg.cn/appstock/app/fqkline/get?_var=kline_dayqfq&param=${prefix}${symbol},day,,,120,qfq`;
    const response = await axios.get(url, { 
      timeout: 4000,
      httpAgent,
      httpsAgent
    });
    const dataStr = response.data;
    if (!dataStr) return null;
    
    let data;
    if (typeof dataStr === 'string') {
      const eqIndex = dataStr.indexOf('=');
      if (eqIndex !== -1) {
        const jsonStr = dataStr.substring(eqIndex + 1);
        data = JSON.parse(jsonStr);
      } else {
        try {
          data = JSON.parse(dataStr);
        } catch (e) {
          return null;
        }
      }
    } else {
      data = dataStr;
    }
    
    const stockKey = `${prefix}${symbol}`;
    if (!data.data || !data.data[stockKey]) return null;
    
    const stockData = data.data[stockKey];
    const klines = stockData.qfqday || stockData.day;
    
    if (!klines || !Array.isArray(klines)) return null;

    return klines.map((line: any[]) => ({
      date: line[0],
      open: parseFloat(line[1]),
      close: parseFloat(line[2]),
      high: parseFloat(line[3]),
      low: parseFloat(line[4]),
      vol: parseFloat(line[5])
    }));
  } catch (error: any) {
    if (retries > 0) {
      return fetchTencentHistory(symbol, market, retries - 1);
    }
    return null;
  }
}


async function fetchIndustryMap() {
  const industryMap: Record<string, string> = {};
  try {
    console.log("Fetching industry mapping from Eastmoney...");
    const batchSize = 50;
    const maxPages = 120; 
    
    for (let page = 1; page <= maxPages; page++) {
      let retries = 5;
      let success = false;
      while (retries > 0 && !success) {
        try {
          // Using http instead of https for potentially better stability with some servers
          const url = `http://push2.eastmoney.com/api/qt/clist/get?pn=${page}&pz=${batchSize}&po=1&np=1&ut=bd1d9ddb040897f352c29ee4f395b3e2&fltt=2&invt=2&fid=f3&fs=m:0+t:6,m:0+t:80,m:1+t:2,m:1+t:23&fields=f12,f100`;
          const res = await axios.get(url, {
            headers: {
              "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
              "Referer": "http://quote.eastmoney.com/center/gridlist.html"
            },
            timeout: 15000,
            httpAgent,
            httpsAgent
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
            if (page % 20 === 0) console.log(`Fetched industry page ${page}...`);
            success = true;
          } else {
            retries--;
            await new Promise(resolve => setTimeout(resolve, 1000));
          }
        } catch (e: any) {
          retries--;
          console.warn(`Retry ${5 - retries} for industry page ${page} failed: ${e.message}`);
          await new Promise(resolve => setTimeout(resolve, 2000));
        }
      }
      if (!success) {
        console.warn(`Failed to fetch industry page ${page} after retries.`);
        if (page === 1) {
          console.warn("Failing fast since the first page failed. EastMoney API might be blocking the IP.");
          break;
        }
      }
      await new Promise(resolve => setTimeout(resolve, 500));
      
      if (Object.keys(industryMap).length > 5500) break;
    }
    console.log(`Industry mapping built for ${Object.keys(industryMap).length} stocks.`);
  } catch (error: any) {
    console.error("Failed to fetch industry map:", error.message);
  }
  return industryMap;
}

// Background Scanner Logic
async function runFullScan() {
  const status = db.prepare("SELECT is_scanning FROM scan_status WHERE id = 1").get() as any;
  if (status?.is_scanning) {
    console.log("Scan already in progress, skipping...");
    return;
  }

  db.prepare("UPDATE scan_status SET is_scanning = 1 WHERE id = 1").run();
  db.prepare("DELETE FROM filtered_stocks").run(); // Clear old results
  console.log("Starting full A-share scan...");

  try {
    const industryMap = await fetchIndustryMap();
    const pageSize = 100;
    const allStocks: any[] = [];
    
    // Fetch all stocks (approx 5500 stocks, so 60 pages is safe)
    for (let pn = 1; pn <= 65; pn++) {
      const sinaUrl = `http://vip.stock.finance.sina.com.cn/quotes_service/api/json_v2.php/Market_Center.getHQNodeData?page=${pn}&num=${pageSize}&sort=amount&asc=0&node=hs_a&symbol=&_s_r_a=init`;
      let data = await fetchSinaData(sinaUrl);
      
      if (data && Array.isArray(data) && data.length > 0) {
        const stocks = data.map((s: any) => {
          const fullSymbol = s.symbol;
          const market = fullSymbol.substring(0, 2) === 'sh' ? 1 : 0;
          return {
            symbol: s.code,
            fullSymbol: fullSymbol,
            market: market,
            name: s.name,
            price: parseFloat(s.trade),
            pct_chg: parseFloat(s.changepercent),
            industry: industryMap[s.code] || "未知行业"
          };
        });
        allStocks.push(...stocks);
        console.log(`Fetched page ${pn}, total stocks: ${allStocks.length}`);
      } else {
        console.log(`No more data on page ${pn} or Sina error.`);
        break; // No more stocks
      }
    }

    if (allStocks.length === 0) {
      console.error("Failed to fetch any stocks from Sina. Scan aborted.");
      throw new Error("No stocks found");
    }

    db.prepare("UPDATE scan_status SET is_scanning = 1, progress_current = 0, progress_total = ? WHERE id = 1").run(allStocks.length);
    console.log(`Fetched ${allStocks.length} stocks. Starting strategy filtering...`);
    
    // Clear old results for a fresh scan
    db.prepare("DELETE FROM filtered_stocks").run();

    const CONCURRENCY = 10; // Reduced concurrency to be safer
    const strategies = ["oversold_volume", "oversold_only", "volume_breakout", "bottom_reversal", "shao_fu", "n_pattern"];
    const kdjThreshold = 25;

    const insertStock = db.prepare("INSERT OR REPLACE INTO filtered_stocks (strategy, symbol, industry, data) VALUES (?, ?, ?, ?)");
    const updateProgress = db.prepare("UPDATE scan_status SET progress_current = ? WHERE id = 1");

    for (let i = 0; i < allStocks.length; i += CONCURRENCY) {
      const batch = allStocks.slice(i, i + CONCURRENCY);
      
      const results = await Promise.all(batch.map(async (stock) => {
        try {
          const klines = await fetchTencentHistory(stock.symbol, stock.market);
          if (!klines || klines.length < 20) return [];

          const kdjValues = calculateKDJ(klines);
          if (!kdjValues) return [];

          const lastKDJ = kdjValues[kdjValues.length - 1];
          const last5Days = klines.slice(-5);
          const todayVol = klines[klines.length - 1].vol;
          const yesterdayVol = klines[klines.length - 2].vol;
          const todayPctChg = stock.pct_chg;
          const isVolumeShrinking = todayVol < yesterdayVol;
          const avgVol5 = last5Days.reduce((acc, curr) => acc + curr.vol, 0) / 5;

          const matches = [];
          for (const strategy of strategies) {
            let matched = false;
            if (strategy === "oversold_volume") {
              matched = lastKDJ.j < kdjThreshold && isVolumeShrinking;
            } else if (strategy === "oversold_only") {
              matched = lastKDJ.j < kdjThreshold;
            } else if (strategy === "volume_breakout") {
              matched = todayVol > (avgVol5 * 2) && todayPctChg > 0;
            } else if (strategy === "bottom_reversal") {
              matched = lastKDJ.j < (kdjThreshold + 10) && todayPctChg > 2;
            } else if (strategy === "shao_fu") {
              const last60 = klines.slice(-60);
              const high60 = Math.max(...last60.map(d => d.high));
              const low60 = Math.min(...last60.map(d => d.low));
              const volatility = (high60 - low60) / low60;
              const volMatch = volatility <= 1.0;
              const bbiValues = calculateBBI(klines);
              const todayBBI = bbiValues[bbiValues.length - 1];
              const yesterdayBBI = bbiValues[bbiValues.length - 2];
              const bbiRising = todayBBI !== null && yesterdayBBI !== null && todayBBI > yesterdayBBI;
              const jValueMatch = lastKDJ.j < 0;
              const difValues = calculateDIF(klines);
              const todayDIF = difValues[difValues.length - 1];
              const difMatch = !isNaN(todayDIF) && todayDIF > 0;
              matched = volMatch && bbiRising && jValueMatch && difMatch;
            } else if (strategy === "n_pattern") {
              matched = checkNPattern(klines);
            }

            if (matched) {
              const stockData = {
                ts_code: stock.symbol,
                symbol: stock.symbol,
                name: stock.name,
                price: stock.price,
                pct_chg: stock.pct_chg,
                industry: stock.industry || "未知行业",
                kdj: lastKDJ,
                is_volume_shrinking: isVolumeShrinking,
                volume_trend: last5Days.map(d => d.vol),
                history: klines.slice(-15).map(i => ({ date: i.date, close: i.close, vol: i.vol }))
              };
              matches.push({ strategy, symbol: stock.symbol, industry: stock.industry || "未知行业", data: JSON.stringify(stockData) });
            }
          }
          return matches;
        } catch (e) {
          return [];
        }
      }));

      // Batch write to DB in a transaction
      const transaction = db.transaction((allMatches: any[]) => {
        for (const match of allMatches) {
          insertStock.run(match.strategy, match.symbol, match.industry, match.data);
        }
      });
      
      const flattenedMatches = results.flat();
      if (flattenedMatches.length > 0) {
        transaction(flattenedMatches);
      }

      const currentProgress = Math.min(i + CONCURRENCY, allStocks.length);
      updateProgress.run(currentProgress);

      if (i % 100 === 0) {
        console.log(`Scan Progress: ${currentProgress}/${allStocks.length}...`);
      }
      
      // Small delay between batches to prevent rate limiting
      await new Promise(resolve => setTimeout(resolve, 100));
    }

    db.prepare("UPDATE scan_status SET last_scan_time = ?, is_scanning = 0 WHERE id = 1").run(new Date().toISOString());
    console.log("Full scan completed successfully.");
  } catch (error: any) {
    console.error("Full scan error:", error.message);
  } finally {
    db.prepare("UPDATE scan_status SET is_scanning = 0 WHERE id = 1").run();
  }
}

app.get("/api/scan/status", (req, res) => {
  const status = db.prepare("SELECT last_scan_time, is_scanning, progress_current, progress_total FROM scan_status WHERE id = 1").get() as any;
  res.json(status);
});

app.post("/api/scan/reset", (req, res) => {
  db.prepare("UPDATE scan_status SET is_scanning = 0 WHERE id = 1").run();
  res.json({ status: "ok", message: "扫描状态已重置" });
});

app.get("/api/stocks/filter", async (req, res) => {
  try {
    const strategy = (req.query.strategy as string) || "oversold_volume";
    const rows = db.prepare("SELECT data FROM filtered_stocks WHERE strategy = ?").all(strategy) as any[];
    const results = rows.map(r => JSON.parse(r.data));
    
    // Sort by J value (ascending)
    results.sort((a, b) => a.kdj.j - b.kdj.j);

    const status = db.prepare("SELECT last_scan_time FROM scan_status WHERE id = 1").get() as any;

    res.json({
      stocks: results,
      metadata: {
        last_scan_time: status?.last_scan_time,
        total_found: results.length
      }
    });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

async function startServer() {
  if (process.env.NODE_ENV !== "production") {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: "spa",
    });
    app.use(vite.middlewares);
  } else {
    app.use(express.static(path.join(__dirname, "dist")));
    app.get("*", (req, res) => {
      res.sendFile(path.join(__dirname, "dist", "index.html"));
    });
  }

  app.listen(PORT, "0.0.0.0", () => {
    console.log(`Server running on http://localhost:${PORT}`);
    
    // Reset scanning status on startup to prevent stuck states from crashes
    db.prepare("UPDATE scan_status SET is_scanning = 0, progress_current = 0, progress_total = 0 WHERE id = 1").run();
    
    // Initial scan on startup if needed
    const status = db.prepare("SELECT last_scan_time FROM scan_status WHERE id = 1").get() as any;
    const lastScan = status?.last_scan_time ? new Date(status.last_scan_time) : null;
    const now = new Date();
    
    // If no scan or last scan was more than 12 hours ago, start a new one
    if (!lastScan || (now.getTime() - lastScan.getTime() > 12 * 60 * 60 * 1000)) {
      runFullScan();
    }
    
    // Schedule daily scan
    setInterval(runFullScan, 24 * 60 * 60 * 1000);
  });
}

startServer();
