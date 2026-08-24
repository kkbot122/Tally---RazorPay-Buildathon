import TracePage from "./trace-page";

type TraceRouteProps = {
  searchParams: Promise<{ runId?: string | string[] }>;
};

export default async function TraceRoute({ searchParams }: TraceRouteProps) {
  const params = await searchParams;
  const runId = typeof params.runId === "string" ? params.runId : undefined;
  return <TracePage runId={runId} />;
}
