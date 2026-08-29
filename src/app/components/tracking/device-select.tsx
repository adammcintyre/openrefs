/**
 * Desktop or mobile, as a labelled select and as a table badge.
 *
 * Device is part of a tracked keyword's identity, not a view filter: the same
 * word tracked on both devices is two rows with two independent position
 * histories, because Google returns two different result pages. That is why
 * the badge appears on every row rather than only when a project mixes the
 * two — a table showing one position per keyword with no device shown would
 * silently pick one.
 */
import { Monitor, Smartphone } from "lucide-react";

import { DEVICES, type Device } from "../../../shared/projects";
import { Badge, Field, Select } from "../ui";

const DEVICE_LABELS: Record<Device, string> = {
  desktop: "Desktop",
  mobile: "Mobile",
};

export function deviceLabel(device: Device): string {
  return DEVICE_LABELS[device];
}

export function DeviceSelect({
  value,
  onChange,
  disabled = false,
  label = "Device",
  hint,
}: {
  value: Device;
  onChange: (device: Device) => void;
  disabled?: boolean;
  label?: string;
  hint?: string;
}) {
  return (
    <Field label={label} hint={hint}>
      {(props) => (
        <Select
          {...props}
          value={value}
          disabled={disabled}
          onChange={(event) => onChange(event.target.value as Device)}
        >
          {DEVICES.map((device) => (
            <option key={device} value={device}>
              {DEVICE_LABELS[device]}
            </option>
          ))}
        </Select>
      )}
    </Field>
  );
}

/** The table's device column. Icon plus word — never the icon alone. */
export function DeviceBadge({ device }: { device: Device }) {
  const Icon = device === "mobile" ? Smartphone : Monitor;
  return (
    <Badge variant="neutral">
      <Icon className="size-3" aria-hidden="true" />
      {DEVICE_LABELS[device]}
    </Badge>
  );
}
