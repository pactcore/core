import type { PaymentRouter } from "../../application/contracts";
import { generateId } from "../../application/utils";
import type { PaymentRoute } from "../../domain/payment-routing";

export class InMemoryPaymentRouter implements PaymentRouter {
  private readonly routes: PaymentRoute[] = [];

  async route(
    fromId: string,
    toId: string,
    amount: number,
    currency: string,
    reference: string,
  ): Promise<PaymentRoute> {
    const route: PaymentRoute = {
      id: generateId("route"),
      fromId,
      toId,
      amount,
      currency,
      reference,
      routeType: this.resolveRouteType(reference, currency),
      status: this.isValidRoute(fromId, toId, amount, currency) ? "completed" : "failed",
      createdAt: Date.now(),
    };

    this.routes.push(route);
    return { ...route };
  }

  async listRoutes(): Promise<PaymentRoute[]> {
    return this.routes.map((route) => ({ ...route }));
  }

  private isValidRoute(fromId: string, toId: string, amount: number, currency: string): boolean {
    if (!fromId.trim() || !toId.trim() || !currency.trim()) {
      return false;
    }
    if (!Number.isFinite(amount) || amount <= 0) {
      return false;
    }
    return true;
  }

  private resolveRouteType(
    reference: string,
    currency: string,
  ): "direct" | "swap" | "aggregated" | "credit" {
    const normalizedReference = reference.toLowerCase();
    const normalizedCurrency = currency.toLowerCase();

    if (normalizedReference.startsWith("credit:")) {
      return "credit";
    }
    if (
      normalizedReference.startsWith("batch:") ||
      normalizedReference.startsWith("aggregated:") ||
      normalizedReference.includes("micropayment")
    ) {
      return "aggregated";
    }
    if (
      normalizedReference.startsWith("swap:") ||
      normalizedCurrency.includes("->") ||
      normalizedCurrency.includes("/")
    ) {
      return "swap";
    }
    return "direct";
  }
}
