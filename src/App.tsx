import React, { useState, useEffect } from "react";
import { 
  Search, 
  TrendingDown, 
  BarChart3, 
  AlertCircle, 
  RefreshCw, 
  ArrowUpRight, 
  ArrowDownRight,
  Info
} from "lucide-react";
import { 
  LineChart, 
  Line, 
  XAxis, 
  YAxis, 
  Tooltip, 
  ResponsiveContainer, 
  AreaChart, 
  Area 
} from "recharts";
import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";
import { Stock } from "./types";

function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

export default function App() {
  const [stocks, setStocks] = useState<Stock[]>([]);
  const [metadata, setMetadata] = useState<{ last_scan_time: string; total_found: number } | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [scanStatus, setScanStatus] = useState<{ 
    last_scan_time: string | null; 
    is_scanning: boolean;
    progress_current: number;
    progress_total: number;
  }>({
    last_scan_time: null,
    is_scanning: false,
    progress_current: 0,
    progress_total: 0
  });
  const [kdjThreshold, setKdjThreshold] = useState(25);
  const [strategy, setStrategy] = useState("oversold_volume");

  const strategies = [
    { 
      id: "oversold_volume", 
      name: "超跌 + 缩量", 
      desc: "寻找极致超跌且成交量见底的个股",
      rules: ["KDJ-J值 < 阈值", "今日成交量 < 昨日成交量"]
    },
    { 
      id: "oversold_only", 
      name: "仅超跌 (J值)", 
      desc: "寻找纯粹指标超跌的个股",
      rules: ["KDJ-J值 < 阈值"]
    },
    { 
      id: "volume_breakout", 
      name: "放量突破", 
      desc: "寻找成交量异常放大且股价上涨的个股",
      rules: ["今日成交量 > 5日均量 * 2", "今日涨幅 > 0%"]
    },
    { 
      id: "bottom_reversal", 
      name: "底部反转", 
      desc: "寻找低位企稳并开始放量反弹的个股",
      rules: ["KDJ-J值 < 阈值 + 10", "今日涨幅 > 2%"]
    },
    { 
      id: "shao_fu", 
      name: "少妇战法", 
      desc: "寻找波动收敛、趋势向上且指标极度超跌的个股",
      rules: ["60日波动 ≤ 100%", "BBI趋势上升", "J值 < 0", "DIF > 0"]
    },
    { 
      id: "n_pattern", 
      name: "N型战法", 
      desc: "识别高标准N型上升结构，捕捉强趋势中继机会",
      rules: ["A < C < B < D (抬高)", "B-A 涨幅 ≥ 10%", "B-C 回调 20%-50%", "高点放量/低点缩量", "价格站稳 MA20/MA60"]
    },
  ];

  const currentStrategy = strategies.find(s => s.id === strategy) || strategies[0];

  const fetchStocks = async () => {
    setLoading(true);
    setError(null);
    try {
      // Fetch scan status
      const statusRes = await fetch('/api/scan/status');
      const statusData = await statusRes.json();
      setScanStatus(statusData);

      // Fetch filtered stocks
      const response = await fetch(`/api/stocks/filter?kdj_k=${kdjThreshold}&strategy=${strategy}`);
      const data = await response.json();
      if (response.ok) {
        setStocks(data.stocks);
        setMetadata(data.metadata);
      } else {
        setError(data.error || "获取数据失败");
      }
    } catch (err) {
      setError("获取数据时发生网络错误。");
    } finally {
      setLoading(false);
    }
  };

  const handleResetScan = async () => {
    if (!confirm("确定要强制重置扫描状态吗？这通常用于修复扫描卡住的问题。")) return;
    try {
      await fetch('/api/scan/reset', { method: 'POST' });
      fetchStocks();
    } catch (err) {
      alert("重置失败");
    }
  };

  useEffect(() => {
    fetchStocks();
    
    // Poll for scan status every 5 seconds
    const interval = setInterval(async () => {
      try {
        const statusRes = await fetch('/api/scan/status');
        const statusData = await statusRes.json();
        setScanStatus(statusData);
      } catch (e) {
        // Ignore
      }
    }, 5000);
    
    return () => clearInterval(interval);
  }, []); // Only fetch once on mount, then poll status

  return (
    <div className="min-h-screen bg-[#E4E3E0] text-[#141414] font-sans selection:bg-[#141414] selection:text-[#E4E3E0]">
      {/* Header */}
      <header className="border-b border-[#141414] p-6 flex flex-col md:flex-row justify-between items-start md:items-center gap-4 bg-white/30 backdrop-blur-md sticky top-0 z-50">
        <div>
          <h1 className="text-3xl font-serif italic tracking-tight">A股筛选器</h1>
          <p className="text-xs uppercase tracking-widest opacity-50 mt-1">策略引擎控制台</p>
        </div>

        <div className="flex flex-wrap items-center gap-4 w-full md:w-auto">
          {/* Core Strategies Selection */}
          <div className="flex items-center gap-2 bg-[#141414]/5 p-1 rounded-lg border border-[#141414]/10">
            {strategies.map((s) => (
              <button
                key={s.id}
                onClick={() => setStrategy(s.id)}
                className={cn(
                  "px-3 py-1.5 text-[10px] font-bold uppercase tracking-wider rounded transition-all",
                  strategy === s.id 
                    ? "bg-[#141414] text-[#E4E3E0]" 
                    : "hover:bg-[#141414]/10 text-[#141414]/60"
                )}
              >
                {s.name}
              </button>
            ))}
          </div>

          <div className="flex items-center gap-4 bg-[#141414]/5 p-2 rounded border border-[#141414]/10">
            <div className="flex flex-col">
              <label className="text-[9px] uppercase font-bold opacity-40 leading-none mb-1">KDJ 阈值</label>
              <input 
                type="number" 
                value={kdjThreshold} 
                onChange={(e) => setKdjThreshold(Number(e.target.value))}
                className="bg-transparent border-none p-0 text-sm font-mono focus:ring-0 w-10 h-4"
              />
            </div>
          </div>

          <div className="flex items-center gap-4 ml-auto">
            {scanStatus.is_scanning && (
              <div className="flex flex-col items-end">
                <div className="flex items-center gap-2 px-3 py-1 bg-emerald-500/10 border border-emerald-500/20 rounded-full">
                  <RefreshCw className="w-3 h-3 text-emerald-600 animate-spin" />
                  <span className="text-[10px] font-bold text-emerald-600 uppercase tracking-wider">
                    后台全量扫描中 ({Math.round((scanStatus.progress_current / (scanStatus.progress_total || 1)) * 100)}%)
                  </span>
                  <button 
                    onClick={handleResetScan}
                    className="ml-2 text-[9px] bg-red-500 text-white px-1.5 py-0.5 rounded hover:bg-red-600 transition-colors"
                    title="强制重置扫描状态"
                  >
                    重置
                  </button>
                </div>
                <div className="w-32 h-1 bg-[#141414]/10 rounded-full mt-1 overflow-hidden">
                  <div 
                    className="h-full bg-emerald-500 transition-all duration-500" 
                    style={{ width: `${(scanStatus.progress_current / (scanStatus.progress_total || 1)) * 100}%` }}
                  />
                </div>
              </div>
            )}
            {scanStatus.last_scan_time && (
              <div className="flex flex-col items-end">
                <span className="text-[9px] uppercase font-bold opacity-40 leading-none mb-1">最后更新时间</span>
                <span className="text-[10px] font-mono font-bold">
                  {new Date(scanStatus.last_scan_time).toLocaleString()}
                </span>
              </div>
            )}
            <button 
              onClick={fetchStocks}
              disabled={loading}
              className="group flex items-center gap-2 border border-[#141414] px-4 py-2 hover:bg-[#141414] hover:text-[#E4E3E0] transition-all disabled:opacity-50"
            >
              <RefreshCw className={cn("w-4 h-4", loading && "animate-spin")} />
              <span className="text-xs font-bold uppercase tracking-wider">{loading ? "同步中" : "刷新"}</span>
            </button>
          </div>
        </div>
      </header>

      {/* Strategy Info Banner */}
      <div className="bg-[#141414] text-[#E4E3E0] px-6 py-4 flex flex-col md:flex-row justify-between items-start md:items-center gap-4">
        <div className="flex flex-col">
          <div className="flex items-center gap-2 mb-1">
            <TrendingDown className="w-4 h-4 text-emerald-400" />
            <span className="text-xs font-bold uppercase tracking-[0.2em]">核心策略: {currentStrategy.name}</span>
          </div>
          <p className="text-sm font-serif italic opacity-70">{currentStrategy.desc}</p>
        </div>
        
        <div className="flex flex-wrap gap-2">
          {currentStrategy.rules.map((rule, idx) => (
            <div key={idx} className="bg-white/10 border border-white/20 px-3 py-1 rounded text-[10px] font-mono flex items-center gap-2">
              <div className="w-1 h-1 rounded-full bg-emerald-400" />
              {rule}
            </div>
          ))}
        </div>
      </div>

      <main className="p-6">
        {error && (
          <div className="mb-8 border border-red-500/50 bg-red-500/5 p-4 flex items-start gap-3">
            <AlertCircle className="w-5 h-5 text-red-600 mt-0.5" />
            <div>
              <h3 className="text-sm font-bold text-red-600 uppercase">错误提示</h3>
              <p className="text-sm opacity-70 mt-1">{error}</p>
            </div>
          </div>
        )}

        {/* Stats Summary */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-6 mb-8">
          <div className="border border-[#141414] p-6 bg-white/50">
            <div className="flex justify-between items-start mb-4">
              <span className="text-[10px] font-mono opacity-50 uppercase tracking-widest">匹配数量</span>
              <Search className="w-4 h-4 opacity-30" />
            </div>
            <div className="text-5xl font-serif italic">{stocks.length}</div>
            <div className="text-[10px] mt-2 opacity-40 uppercase tracking-wider">符合条件的股票</div>
          </div>
          
          <div className="border border-[#141414] p-6 bg-white/50">
            <div className="flex justify-between items-start mb-4">
              <span className="text-[10px] font-mono opacity-50 uppercase tracking-widest">市场状态</span>
              <BarChart3 className="w-4 h-4 opacity-30" />
            </div>
            <div className="text-5xl font-serif italic">全市场</div>
            <div className="text-[10px] mt-2 opacity-40 uppercase tracking-wider">扫描 A 股 5000+ 个股</div>
          </div>

          <div className="border border-[#141414] p-6 bg-white/50">
            <div className="flex justify-between items-start mb-4">
              <span className="text-[10px] font-mono opacity-50 uppercase tracking-widest">核心策略</span>
              <TrendingDown className="w-4 h-4 opacity-30" />
            </div>
            <div className="text-2xl font-bold uppercase tracking-tighter leading-none">极致超跌反弹</div>
            <div className="text-[10px] mt-2 opacity-40 uppercase tracking-wider">量价背离筛选</div>
          </div>
        </div>

        {/* Data Grid */}
        <div className="border border-[#141414]">
          {/* Table Header */}
          <div className="grid grid-cols-12 border-b border-[#141414] bg-[#141414] text-[#E4E3E0] p-4 text-[10px] font-bold uppercase tracking-widest">
            <div className="col-span-2">股票名称 / 代码</div>
            <div className="col-span-2">所属行业</div>
            <div className="col-span-1 text-right">现价</div>
            <div className="col-span-1 text-right">涨跌幅</div>
            <div className="col-span-2 text-center">KDJ 指标 (K/D/J)</div>
            <div className="col-span-2 text-center">成交量趋势</div>
            <div className="col-span-2 text-right">价格走势</div>
          </div>

          {loading ? (
            <div className="p-20 flex flex-col items-center justify-center gap-4 opacity-40">
              <RefreshCw className="w-8 h-8 animate-spin" />
              <span className="text-xs font-mono uppercase tracking-[0.2em]">正在扫描全市场...</span>
            </div>
          ) : stocks.length === 0 ? (
            <div className="p-20 text-center opacity-40">
              <span className="text-xs font-mono uppercase tracking-[0.2em]">今日暂未发现符合条件的股票。</span>
            </div>
          ) : (
            stocks.map((stock) => (
              <div 
                key={stock.ts_code}
                className="grid grid-cols-12 border-b border-[#141414] p-4 hover:bg-[#141414] hover:text-[#E4E3E0] transition-colors group cursor-pointer"
              >
                <div className="col-span-2 flex flex-col">
                  <span className="font-bold text-sm">{stock.name}</span>
                  <span className="text-[10px] font-mono opacity-50 group-hover:opacity-70">{stock.ts_code}</span>
                </div>
                
                <div className="col-span-2 flex items-center">
                  <span className="text-xs opacity-70 group-hover:opacity-100">{stock.industry || "未知行业"}</span>
                </div>

                <div className="col-span-1 flex items-center justify-end font-mono text-sm">
                  ¥{stock.price.toFixed(2)}
                </div>

                <div className={cn(
                  "col-span-1 flex items-center justify-end font-mono text-xs",
                  stock.pct_chg >= 0 ? "text-red-600 group-hover:text-red-400" : "text-green-600 group-hover:text-green-400"
                )}>
                  {stock.pct_chg >= 0 ? <ArrowUpRight className="w-3 h-3 mr-1" /> : <ArrowDownRight className="w-3 h-3 mr-1" />}
                  {stock.pct_chg.toFixed(2)}%
                </div>

                <div className="col-span-2 flex items-center justify-center gap-2">
                  <div className="flex flex-col items-center">
                    <span className="text-[10px] font-mono font-bold text-blue-600 group-hover:text-blue-400">{stock.kdj.k.toFixed(1)}</span>
                    <span className="text-[8px] opacity-40 uppercase">K</span>
                  </div>
                  <div className="w-[1px] h-4 bg-[#141414] opacity-10 group-hover:bg-[#E4E3E0] group-hover:opacity-30" />
                  <div className="flex flex-col items-center">
                    <span className="text-[10px] font-mono">{stock.kdj.d.toFixed(1)}</span>
                    <span className="text-[8px] opacity-40 uppercase">D</span>
                  </div>
                  <div className="w-[1px] h-4 bg-[#141414] opacity-10 group-hover:bg-[#E4E3E0] group-hover:opacity-30" />
                  <div className="flex flex-col items-center">
                    <span className="text-[10px] font-mono">{stock.kdj.j.toFixed(1)}</span>
                    <span className="text-[8px] opacity-40 uppercase">J</span>
                  </div>
                </div>

                <div className="col-span-2 flex items-center justify-center px-4 relative">
                  {stock.is_volume_shrinking && (
                    <div className="absolute -top-1 right-2 text-[8px] font-bold text-emerald-600 bg-emerald-50 px-1 border border-emerald-200">缩量</div>
                  )}
                  <div className="w-full h-8">
                    <ResponsiveContainer width="100%" height="100%">
                      <AreaChart data={stock.volume_trend.map((v, i) => ({ v, i }))}>
                        <YAxis hide domain={['dataMin', 'dataMax']} />
                        <Area 
                          type="monotone" 
                          dataKey="v" 
                          stroke="currentColor" 
                          fill="currentColor" 
                          fillOpacity={0.1} 
                          isAnimationActive={false}
                        />
                      </AreaChart>
                    </ResponsiveContainer>
                  </div>
                </div>

                <div className="col-span-2 flex items-center justify-end px-2">
                  <div className="w-full h-8">
                    <ResponsiveContainer width="100%" height="100%">
                      <LineChart data={stock.history}>
                        <YAxis hide domain={['dataMin', 'dataMax']} />
                        <Line 
                          type="monotone" 
                          dataKey="close" 
                          stroke="currentColor" 
                          strokeWidth={1.5} 
                          dot={false} 
                          isAnimationActive={false}
                        />
                      </LineChart>
                    </ResponsiveContainer>
                  </div>
                </div>
              </div>
            ))
          )}
        </div>
      </main>

      {/* Footer Info */}
      <footer className="p-12 border-t border-[#141414] mt-20 opacity-50">
        <div className="max-w-4xl mx-auto text-center">
          <div className="flex justify-center gap-8 mb-6">
            <div className="flex items-center gap-2">
              <div className="w-2 h-2 rounded-full bg-blue-500" />
              <span className="text-[10px] font-bold uppercase tracking-widest">KDJ &lt; 5 (超跌)</span>
            </div>
            <div className="flex items-center gap-2">
              <div className="w-2 h-2 rounded-full bg-emerald-500" />
              <span className="text-[10px] font-bold uppercase tracking-widest">成交量萎缩 (地量)</span>
            </div>
          </div>
          <p className="text-xs font-serif italic leading-relaxed">
            "股市是把钱从急躁的人手里转移到耐心的人手里的工具。" 
            <br />
            <span className="not-italic font-sans text-[10px] uppercase tracking-widest mt-2 block">— 量化分析工具</span>
          </p>
          <div className="mt-8 pt-8 border-t border-[#141414]/10 flex items-center justify-center gap-2 text-[10px] font-mono">
            <Info className="w-3 h-3" />
            <span>数据源: AKSHARE (东方财富接口). 投资有风险，入市需谨慎。</span>
          </div>
        </div>
      </footer>
    </div>
  );
}
