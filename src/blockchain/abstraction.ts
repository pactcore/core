export interface EscrowAccount {
  taskId: string;
  payerId: string;
  amountCents: number;
  released: boolean;
  releaseTxId?: string;
}
