export interface KDJ {
  k: number;
  d: number;
  j: number;
}

export interface StockHistory {
  date: string;
  close: number;
  vol: number;
}

export interface Stock {
  ts_code: string;
  symbol: string;
  name: string;
  area: string;
  industry: string;
  price: number;
  pct_chg: number;
  kdj: KDJ;
  is_volume_shrinking: boolean;
  volume_trend: number[];
  history: StockHistory[];
}
