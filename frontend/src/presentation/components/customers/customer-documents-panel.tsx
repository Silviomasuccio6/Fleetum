import { RentalCustomerProfile } from "../../../application/usecases/rental-bookings-usecases";
import { Button } from "../ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "../ui/card";
import { Input } from "../ui/input";
import { Label } from "../ui/label";

type Props = {
  customer: RentalCustomerProfile | null;
  files: File[];
  saving: boolean;
  onFilesChange: (files: File[]) => void;
  onUpload: () => void;
  onOpenAttachment: (attachmentId: string) => void;
  onRemoveAttachment: (attachmentId: string) => void;
};

const formatBytes = (value?: number | null) => {
  if (!value || value <= 0) return "-";
  if (value < 1024) return `${value} B`;
  if (value < 1024 * 1024) return `${(value / 1024).toFixed(1)} KB`;
  return `${(value / (1024 * 1024)).toFixed(1)} MB`;
};

export const CustomerDocumentsPanel = ({
  customer,
  files,
  saving,
  onFilesChange,
  onUpload,
  onOpenAttachment,
  onRemoveAttachment
}: Props) => {
  return (
    <Card className="saas-surface">
      <CardHeader className="pb-2">
        <CardTitle className="text-base">Documenti Cliente</CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        <div className="space-y-2 rounded-lg border bg-muted/20 p-3">
          <Label>Carica allegati (PDF/JPG/PNG/WebP)</Label>
          <Input
            type="file"
            multiple
            accept=".pdf,.jpg,.jpeg,.png,.webp"
            onChange={(event) => onFilesChange(Array.from(event.target.files ?? []))}
          />
          {files.length > 0 ? (
            <p className="text-xs text-muted-foreground">Selezionati: {files.map((file) => file.name).join(", ")}</p>
          ) : null}
          <Button type="button" variant="outline" disabled={!customer?.id || files.length === 0 || saving} onClick={onUpload}>
            Salva documenti
          </Button>
        </div>

        {!customer || (customer.attachments ?? []).length === 0 ? (
          <p className="rounded-lg border border-dashed p-3 text-xs text-muted-foreground">Nessun allegato cliente disponibile.</p>
        ) : (
          <div className="space-y-1 rounded-lg border p-2">
            {(customer.attachments ?? []).map((attachment) => (
              <div key={attachment.id} className="flex flex-wrap items-center justify-between gap-2 rounded-md border bg-background/80 px-2 py-1">
                <div className="min-w-0">
                  <p className="truncate text-xs font-medium">{attachment.fileName}</p>
                  <p className="text-[11px] text-muted-foreground">
                    {attachment.mimeType} · {formatBytes(attachment.sizeBytes)} ·{" "}
                    {new Date(attachment.createdAt).toLocaleString("it-IT")}
                  </p>
                </div>
                <div className="flex items-center gap-1">
                  <Button size="sm" variant="outline" onClick={() => onOpenAttachment(attachment.id)}>
                    Apri
                  </Button>
                  <Button size="sm" variant="outline" onClick={() => onRemoveAttachment(attachment.id)}>
                    Elimina
                  </Button>
                </div>
              </div>
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  );
};
