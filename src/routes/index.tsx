import { createFileRoute } from "@tanstack/react-router";

export const Route = createFileRoute("/")({
  component: Index,
});

function Index() {
  return (
    <div className="flex min-h-screen items-center justify-center">
      <h1 className="text-4xl font-bold text-white bg-black/30 p-4 rounded-lg">
        AI Provider Hub
      </h1>
    </div>
  );
}