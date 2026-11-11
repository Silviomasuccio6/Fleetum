import {PDFDocument} from "pdf-lib";
import assert from "node:assert/strict";
import test from "node:test";
import { RentalBookingsController } from "../src/interfaces/http/controllers/rental-bookings-controller.js";
import { prisma } from "../src/infrastructure/database/prisma/client.js";
import { AppError } from "../src/shared/errors/app-error.js";

type MockResponse = {
  statusCode: number;
  headers: Record<string, string>;
  body: unknown;
  status: (code: number) => MockResponse;
  json: (payload: unknown) => MockResponse;
  send: (payload: unknown) => MockResponse;
  setHeader: (name: string, value: string) => void;
};

const createMockResponse = (): MockResponse => {
  const res: MockResponse = {
    statusCode: 200,
    headers: {},
    body: null,
    status(code: number) {
      this.statusCode = code;
      return this;
    },
    json(payload: unknown) {
      this.body = payload;
      return this;
    },
    send(payload: unknown) {
      this.body = payload;
      return this;
    },
    setHeader(name: string, value: string) {
      this.headers[name] = String(value);
    }
  };
  return res;
};

test("contracts smoke: generateContract delegates the atomic contract and workflow write", async () => {
  const controller = new RentalBookingsController({ enqueue: async () => undefined } as any);
  (controller as any).lockMutableContract = async () => undefined;
  (controller as any).frozenContractPdf = async () => null;
  const response = createMockResponse();
  const request = {
    auth: { tenantId: "demo_tenant", userId: "user_1" },
    params: { id: "booking_1" }
  } as any;

  const originalRentalBookingUpdate = prisma.rentalBooking.update;
  let capturedUpdate: any = null;
  (prisma.rentalBooking as any).update = async (input: unknown) => {
    capturedUpdate = input;
    return { id: "booking_1", contractStatus: "READY" };
  };

  (controller as any).getBookingOrThrow = async () => ({ id: "booking_1", code: "BK-0001" });
  (controller as any).upsertBookingContractFromTemplate = async () => ({ id: "contract_1", bookingId: "booking_1" });

  try {
    await controller.generateContract(request, response as any);

    assert.equal(response.statusCode, 201);
    assert.deepEqual(response.body, { id: "contract_1", bookingId: "booking_1" });
    assert.equal(capturedUpdate,null,"Workflow write belongs to the atomic generation transaction");
  } finally {
    (prisma.rentalBooking as any).update = originalRentalBookingUpdate;
  }
});

test("contracts smoke: updateContractDocument sanitizes unsafe content", async () => {
  const controller = new RentalBookingsController({ enqueue: async () => undefined } as any);
  (controller as any).lockMutableContract = async () => undefined;
  (controller as any).frozenContractPdf = async () => null;
  const response = createMockResponse();
  const request = {
    auth: { tenantId: "demo_tenant", userId: "user_2" },
    params: { id: "booking_1" },
    body: {
      title: "<script>alert(1)</script>Titolo Contratto",
      content: "Testo contratto valido <script>alert('x')</script> con dettagli operativi.",
      emailSubject: "Oggetto javascript:alert(1)",
      emailBody: "Body <img src=x onerror=\"alert(1)\">",
      status: "READY"
    }
  } as any;

  const originalTransaction=prisma.$transaction;
  (prisma as any).$transaction=async (callback:any)=>callback({bookingContract:{update:(input:unknown)=>(prisma.bookingContract as any).update(input),findFirst:async()=>({id:"contract_1",status:"READY"})}});
  const originalBookingContractUpdate = prisma.bookingContract.update;
  let capturedUpdate: any = null;
  (prisma.bookingContract as any).update = async (input: unknown) => {
    capturedUpdate = input;
    return { id: "contract_1", ...(input as any).data };
  };

  let capturedEvent: any = null;
  (controller as any).getContractOrThrow = async () => ({ id: "contract_1", bookingId: "booking_1" });
  (controller as any).logContractEvent = async (input: unknown) => {
    capturedEvent = input;
  };

  try {
    await controller.updateContractDocument(request, response as any);

    assert.equal(response.statusCode, 200);
    assert.ok(capturedUpdate);
    assert.equal(capturedUpdate.where.id, "contract_1");
    assert.equal(capturedUpdate.data.title, "Titolo Contratto");
    assert.equal(capturedUpdate.data.content.includes("<script"), false);
    assert.equal(capturedUpdate.data.emailSubject.includes("javascript:"), false);
    assert.equal(capturedUpdate.data.emailBody.includes("onerror"), false);
    assert.equal(capturedUpdate.data.status, "READY");
    assert.equal(capturedEvent.type, "UPDATED");
  } finally {
    (prisma as any).$transaction=originalTransaction;
    (prisma.bookingContract as any).update = originalBookingContractUpdate;
  }
});

test("contracts smoke: sendContractEmail reports the queue SENT state without finalizing the contract", async () => {
  const queued: any[] = [];
  const enqueueDbClients: any[] = [];
  const controller = new RentalBookingsController({
    enqueue: async (payload: unknown, db: unknown) => {
      queued.push(payload);
      enqueueDbClients.push(db);
      return { id: "queue_1" };
    },
    processPending: async () => ({ processed: 1 })
  } as any);
  (controller as any).lockMutableContract = async () => undefined;
  (controller as any).frozenContractPdf = async () => null;
  const response = createMockResponse();
  const request = {
    auth: { tenantId: "demo_tenant", userId: "user_3" },
    params: { id: "booking_1" },
    headers: { "x-idempotency-key": "contract-email-0001" },
    body: {}
  } as any;

  (controller as any).tenantProfileService = {
    contractBranding: async () => ({companyName:"Fleetum Demo",companyEmail:"noreply@example.invalid"})
  };
  // Queue ownership is tested here; actual PDF loading/rendering has its own unit and PostgreSQL coverage.
  (controller as any).buildContractPdf = async () => {
    const pdf=await PDFDocument.create();pdf.addPage();return Buffer.from(await pdf.save());
  };

  const originalTransaction = prisma.$transaction;
  const originalDeliveryFindUnique = prisma.bookingContractDelivery.findUnique;
  const originalEmailQueueFindUnique = prisma.emailQueue.findUnique;
  const originalBookingContractUpdate = prisma.bookingContract.update;

  let contractUpdateCalls = 0;
  const transactionClient = {
    $queryRaw: async () => [{ locked: "1" }],
    bookingContractEmailRequest: {
      findUnique: async () => null,
      create: async () => ({ id: "request_1" })
    },
    bookingContractDelivery: {
      create: async () => ({ id: "delivery_1" })
    }
  };
  (prisma as any).$transaction = async (callback: (tx: typeof transactionClient) => unknown) => callback(transactionClient);
  (prisma.bookingContractDelivery as any).findUnique = async () => ({ status: "SENT", errorMessage: null, sentAt: new Date() });
  (prisma.emailQueue as any).findUnique = async () => ({ status: "SENT", lastError: null });
  (prisma.bookingContract as any).update = async () => {
    contractUpdateCalls += 1;
    throw new Error("The queue worker owns contract finalization");
  };

  let capturedEvent: any = null;
  (controller as any).logContractEvent = async (input: unknown) => {
    capturedEvent = input;
  };
  (controller as any).getContractOrThrow = async () => ({
    issuedAt:new Date("2026-11-07T00:00:00Z"),
    id: "contract_1",
    bookingId: "booking_1",
    emailTo: null,
    emailSubject: "Contratto {{booking.code}}",
    emailBody: "Body {{customer.fullName}}",
    title: "Contratto BK-0001",
    content: "Contenuto contratto",
    booking: {
      id: "booking_1",
      code: "BK-0001",
      customerName: "Mario Rossi",
      customerEmail: "mario.rossi@example.com",
      customer: { firstName: "Mario", lastName: "Rossi", email: "mario.rossi@example.com" },
      vehicle: { plate: "AB123CD", brand: "Fiat", model: "Tipo" }
    }
  });

  try {
    await controller.sendContractEmail(request, response as any);

    assert.equal(response.statusCode, 201);
    assert.equal((response.body as any).queued, false);
    assert.equal((response.body as any).deliveryId, "delivery_1");
    assert.equal((response.body as any).status, "SENT");
    assert.equal((response.body as any).duplicate, false);
    assert.equal(queued.length, 1);
    assert.equal((queued[0] as any).recipient, "mario.rossi@example.com");
    assert.equal(Array.isArray((queued[0] as any).meta?.attachments), true);
    assert.equal((queued[0] as any).meta?.actorUserId, "user_3");
    assert.equal(enqueueDbClients[0], transactionClient);
    assert.equal(contractUpdateCalls, 0);
    assert.equal(capturedEvent.type, "EMAIL_QUEUED");
  } finally {
    (prisma as any).$transaction = originalTransaction;
    (prisma.bookingContractDelivery as any).findUnique = originalDeliveryFindUnique;
    (prisma.emailQueue as any).findUnique = originalEmailQueueFindUnique;
    (prisma.bookingContract as any).update = originalBookingContractUpdate;
  }
});

test("contracts smoke: sendContractEmail keeps an in-flight leased delivery queued", async () => {
  const controller = new RentalBookingsController({
    enqueue: async () => ({ id: "queue_pending" }),
    processPending: async () => ({ processed: 0 })
  } as any);
  (controller as any).lockMutableContract = async () => undefined;
  (controller as any).frozenContractPdf = async () => null;
  const response = createMockResponse();
  const request = {
    auth: { tenantId: "demo_tenant", userId: "user_pending" },
    params: { id: "booking_1" },
    headers: { "x-idempotency-key": "contract-email-pending" },
    body: {}
  } as any;

  (controller as any).tenantProfileService = {
    contractBranding: async () => ({companyName:"Fleetum Demo",companyEmail:"noreply@example.invalid"})
  };
  // Queue ownership is tested here; actual PDF loading/rendering has its own unit and PostgreSQL coverage.
  (controller as any).buildContractPdf = async () => {
    const pdf=await PDFDocument.create();pdf.addPage();return Buffer.from(await pdf.save());
  };
  (controller as any).getContractOrThrow = async () => ({
    issuedAt:new Date("2026-11-07T00:00:00Z"),
    id: "contract_1",
    bookingId: "booking_1",
    emailTo: null,
    emailSubject: "Contratto {{booking.code}}",
    emailBody: "Body {{customer.fullName}}",
    title: "Contratto BK-0001",
    content: "Contenuto contratto",
    booking: {
      id: "booking_1",
      code: "BK-0001",
      customerName: "Mario Rossi",
      customerEmail: "mario.rossi@example.com",
      customer: { firstName: "Mario", lastName: "Rossi", email: "mario.rossi@example.com" },
      vehicle: { plate: "AB123CD", brand: "Fiat", model: "Tipo" }
    }
  });
  (controller as any).logContractEvent = async () => undefined;

  const originalTransaction = prisma.$transaction;
  const originalDeliveryFindUnique = prisma.bookingContractDelivery.findUnique;
  const originalEmailQueueFindUnique = prisma.emailQueue.findUnique;
  const originalBookingContractUpdate = prisma.bookingContract.update;
  let contractUpdateCalls = 0;
  const transactionClient = {
    $queryRaw: async () => [{ locked: "1" }],
    bookingContractEmailRequest: {
      findUnique: async () => null,
      create: async () => ({ id: "request_pending" })
    },
    bookingContractDelivery: {
      create: async () => ({ id: "delivery_pending" })
    }
  };
  (prisma as any).$transaction = async (callback: (tx: typeof transactionClient) => unknown) => callback(transactionClient);
  // A stale delivery FAILED value must not override a queue item that is still retryable/in flight.
  (prisma.bookingContractDelivery as any).findUnique = async () => ({ status: "FAILED", errorMessage: "transient", sentAt: null });
  (prisma.emailQueue as any).findUnique = async () => ({ status: "PENDING", lastError: "transient" });
  (prisma.bookingContract as any).update = async () => {
    contractUpdateCalls += 1;
    throw new Error("The queue worker owns contract finalization");
  };

  try {
    await controller.sendContractEmail(request, response as any);

    assert.equal(response.statusCode, 201);
    assert.deepEqual(response.body, {
      queued: true,
      deliveryId: "delivery_pending",
      status: "PENDING",
      sentAt: null,
      duplicate: false
    });
    assert.equal(contractUpdateCalls, 0);
  } finally {
    (prisma as any).$transaction = originalTransaction;
    (prisma.bookingContractDelivery as any).findUnique = originalDeliveryFindUnique;
    (prisma.emailQueue as any).findUnique = originalEmailQueueFindUnique;
    (prisma.bookingContract as any).update = originalBookingContractUpdate;
  }
});

test("contracts smoke: sendContractEmail requires a valid idempotency key", async () => {
  const controller = new RentalBookingsController({ enqueue: async () => undefined } as any);
  (controller as any).lockMutableContract = async () => undefined;
  (controller as any).frozenContractPdf = async () => null;
  const response = createMockResponse();

  for (const headers of [undefined, { "x-idempotency-key": "short" }, { "x-idempotency-key": "x".repeat(129) }]) {
    await assert.rejects(
      async () => controller.sendContractEmail({
        auth: { tenantId: "demo_tenant", userId: "user_invalid_key" },
        params: { id: "booking_1" },
        headers,
        body: {}
      } as any, response as any),
      (error: unknown) => {
        assert.ok(error instanceof AppError);
        assert.equal(
          (error as AppError).code,
          headers ? "INVALID_IDEMPOTENCY_KEY" : "IDEMPOTENCY_KEY_REQUIRED"
        );
        return true;
      }
    );
  }
});

test("contracts smoke: sendContractEmail fails when recipient is missing", async () => {
  const controller = new RentalBookingsController({ enqueue: async () => undefined } as any);
  (controller as any).lockMutableContract = async () => undefined;
  (controller as any).frozenContractPdf = async () => null;
  const response = createMockResponse();
  const request = {
    auth: { tenantId: "demo_tenant", userId: "user_4" },
    params: { id: "booking_1" },
    headers: { "x-idempotency-key": "contract-email-nomail" },
    body: {}
  } as any;

  (controller as any).tenantProfileService = {
    contractBranding: async () => ({
      companyName: "Fleetum Demo",
      companyEmail: "noreply@fleetum.it"
    })
  };

  (controller as any).getContractOrThrow = async () => ({
    issuedAt:new Date("2026-11-07T00:00:00Z"),
    id: "contract_1",
    bookingId: "booking_1",
    emailTo: null,
    emailSubject: "Contratto {{booking.code}}",
    emailBody: "Body",
    title: "Contratto BK-0001",
    content: "Contenuto contratto",
    booking: {
      id: "booking_1",
      code: "BK-0001",
      customerName: "Cliente senza email",
      customerEmail: null,
      customer: { firstName: "Cliente", lastName: "NoMail", email: null },
      vehicle: { plate: "AB123CD", brand: "Fiat", model: "Tipo" }
    }
  });

  await assert.rejects(
    async () => controller.sendContractEmail(request, response as any),
    (error: unknown) => {
      assert.ok(error instanceof AppError);
      assert.equal((error as AppError).code, "CONTRACT_EMAIL_MISSING");
      return true;
    }
  );
});

test("contracts smoke: old signature commands cannot mutate a contract without document proof",async()=>{
 const controller=new RentalBookingsController({enqueue:async()=>undefined} as any);
 (controller as any).getContractOrThrow=async()=>({id:"contract_1",status:"READY",issuedAt:new Date()});
 let writes=0;const old=prisma.bookingContract.update;(prisma.bookingContract as any).update=async()=>{writes++;};
 try{for(const body of [{},{signatureDataUrl:"data:image/png;base64,invalid"}])await assert.rejects(()=>controller.markContractSigned({auth:{tenantId:"demo_tenant"},params:{id:"booking_1"},body} as any,createMockResponse() as any),(error:any)=>error.code==="CONTRACT_DOCUMENT_SIGNATURE_REQUIRED");assert.equal(writes,0);}finally{(prisma.bookingContract as any).update=old;}
});

test("contracts smoke: signature data URLs must match the declared image format", () => {
  const controller = new RentalBookingsController({ enqueue: async () => undefined } as any);
  const forged = `data:image/png;base64,${Buffer.from("not-a-png").toString("base64")}`;

  assert.throws(
    () => (controller as any).decodeSignatureDataUrl(forged),
    (error: any) => error?.code === "INVALID_FILE_MAGIC"
  );

  const jpeg = Buffer.from([0xff, 0xd8, 0xff, 0x00]);
  const decoded = (controller as any).decodeSignatureDataUrl(
    `data:image/jpg;base64,${jpeg.toString("base64")}`
  );
  assert.equal(decoded.mimeType, "image/jpeg");
  assert.equal(decoded.extension, "jpg");
});
