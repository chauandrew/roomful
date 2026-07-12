/// <reference types="@cloudflare/workers-types" />
import { routePartykitRequest } from "partyserver";
import type { RoomfulServer } from "./index";

export { RoomfulServer } from "./index";

interface Env {
  Main: DurableObjectNamespace<RoomfulServer>;
}

const worker = {
  async fetch(request: Request, env: Env) {
    return (
      (await routePartykitRequest(request, env)) ??
      new Response("Not found", { status: 404 })
    );
  },
};

export default worker;
