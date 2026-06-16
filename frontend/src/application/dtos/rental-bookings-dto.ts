import type {
  BookingContract,
  RentalBookingStatus,
  RentalCargosStatus,
  RentalContractStatus,
  RentalCustomer
} from "../usecases/rental-bookings-usecases";

export type RentalBookingVehicleDto = {
  id: string;
  plate: string;
  brand: string;
  model: string;
  category?: string | null;
  site?: { id: string; name: string; city?: string | null } | null;
};

export type RentalBookingNoteDto = {
  id: string;
  type: "NOTE" | "SYSTEM" | "CARGOS" | string;
  message: string;
  createdAt: string;
  user?: { id: string; firstName?: string | null; lastName?: string | null } | null;
};

export type RentalBookingDto = {
  id: string;
  code: string;
  status: RentalBookingStatus;
  contractStatus: RentalContractStatus;
  cargosStatus: RentalCargosStatus;
  customerName: string;
  pickupAt: string;
  returnAt: string;
  pickupLocation?: string | null;
  returnLocation?: string | null;
  pickupKm?: number | null;
  returnKm?: number | null;
  expectedTotal?: number | null;
  finalTotal?: number | null;
  createdAt?: string;
  updatedAt?: string;
  vehicle?: RentalBookingVehicleDto | null;
  customer?: RentalCustomer | null;
  contract?: BookingContract | null;
  notes?: RentalBookingNoteDto[];
};

export type RentalBookingListResponseDto = {
  data: RentalBookingDto[];
  total: number;
  page: number;
  pageSize: number;
  kpis: {
    active: number;
    readyForHandover: number;
    inRent: number;
    cargosPending: number;
    cargosErrors: number;
  };
};
