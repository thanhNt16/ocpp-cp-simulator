# OCPP CP Simulator Examples

This directory contains examples demonstrating how to use various features of the OCPP Charge Point Simulator.

## Detailed Meter Values

The `DetailedMeterValueExample.ts` file demonstrates how to send detailed meter values with multiple sampled values, including:

- Voltage readings for each phase (L1, L2, L3)
- Current readings for each phase
- Power readings (active import, offered)
- State of Charge (SoC)
- Energy meter reading

### Usage

```typescript
import { ChargePoint } from "../cp/ChargePoint";
import { sendDetailedMeterValues } from "./examples/DetailedMeterValueExample";

// Assuming you have a ChargePoint instance
const chargePoint = new ChargePoint(/* ... */);

// Send detailed meter values for connector 1
sendDetailedMeterValues(chargePoint, 1);
```

### Custom Meter Values

You can also create your own custom meter value structure:

```typescript
const customMeterValue = {
  timestamp: new Date().toISOString(),
  sampledValue: [
    {
      unit: "V",
      phase: "L1",
      value: "230.5",
      location: "Outlet",
      measurand: "Voltage"
    },
    {
      unit: "A",
      phase: "L1",
      value: "16.0",
      location: "Outlet",
      measurand: "Current.Import"
    },
    // Add more sampled values as needed
  ]
};

// Send the custom meter values
chargePoint.sendDetailedMeterValue(1, customMeterValue);
```

### Available Properties

Each sampled value can include the following properties:

- `value` (required): The value as a string
- `context`: The context of the reading (e.g., "Sample.Periodic", "Transaction.Begin")
- `format`: The format of the value (e.g., "Raw", "SignedData")
- `measurand`: The type of measurement (e.g., "Voltage", "Current.Import", "Power.Active.Import")
- `phase`: The phase of the measurement (e.g., "L1", "L2", "L3")
- `location`: The location of the measurement (e.g., "Outlet", "EV", "Cable")
- `unit`: The unit of the measurement (e.g., "V", "A", "W", "kWh", "Percent")

Refer to the OCPP 1.6 specification for the complete list of allowed values for each property.
