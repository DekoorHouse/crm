export interface ProfitabilityRow {
  id: string;
  name: string;
  campaignName: string | null;
  spend: number;
  pedidos: number;
  pagados: number;
  ingresos: number;
  costos: number;
  profit: number;
  roas: number | null;
  tasaPago: number;
  diasProm: number | null;
}

export interface ProfitabilityResponse {
  success: true;
  range: { from: string; to: string };
  groupBy: "ad" | "campaign";
  totals: {
    spend: number;
    pedidos: number;
    pagados: number;
    ingresos: number;
    costos: number;
    profit: number;
    roas: number | null;
    tasaPago: number;
    diasPromedioLeadAPago: number | null;
  };
  pipeline: {
    pedidosPendientes: number;
    valorPendiente: number;
    esperadoCobrar: number;
  };
  curvaDiaria: {
    date: string;
    spend: number;
    ingresos: number;
    pedidos: number;
    pagados: number;
    pipeline: number;
    incompleto: boolean;
  }[];
  histogramaTiempoAPago: { bucket: string; count: number }[];
  filas: ProfitabilityRow[];
}

export async function fetchProfitability(opts: {
  from: string;
  to: string;
  groupBy: "ad" | "campaign";
}): Promise<ProfitabilityResponse> {
  const params = new URLSearchParams({
    from: opts.from,
    to: opts.to,
    groupBy: opts.groupBy,
  });
  const res = await fetch(`/api/kpi/profitability?${params}`);
  const data = await res.json();
  if (!res.ok || !data.success) {
    throw new Error(data.message || "Error al cargar rentabilidad");
  }
  return data;
}

export interface AskResponse {
  success: true;
  answer: string;
  model: string;
  tokens: { input: number; output: number };
}

export async function askProfitability(opts: {
  question: string;
  snapshot: ProfitabilityResponse;
  history: { q: string; a: string }[];
}): Promise<AskResponse> {
  const res = await fetch(`/api/kpi/profitability/ask`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(opts),
  });
  const data = await res.json();
  if (!res.ok || !data.success) {
    throw new Error(data.message || "Error al preguntar a la IA");
  }
  return data;
}
