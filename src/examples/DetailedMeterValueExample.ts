import { ChargePoint } from "../cp/ChargePoint";

/**
 * Example function demonstrating how to send detailed meter values
 * with the new format that includes voltage, current, power, and SoC readings
 * 
 * @param chargePoint The ChargePoint instance
 * @param connectorId The connector ID to send meter values for
 */
export function sendDetailedMeterValues(chargePoint: ChargePoint, connectorId: number): void {
  // Create a detailed meter value object with multiple sampled values
  const detailedMeterValue = {
    timestamp: new Date().toISOString(),
    sampledValue: [
      {
        unit: "V",
        phase: "L1",
        value: "236.7",
        location: "Outlet",
        measurand: "Voltage"
      },
      {
        unit: "V",
        phase: "L2",
        value: "235.6",
        location: "Outlet",
        measurand: "Voltage"
      },
      {
        unit: "V",
        phase: "L3",
        value: "236.7",
        location: "Outlet",
        measurand: "Voltage"
      },
      {
        unit: "A",
        phase: "L1",
        value: "0.00",
        location: "Outlet",
        measurand: "Current.Import"
      },
      {
        unit: "A",
        phase: "L2",
        value: "0.00",
        location: "Outlet",
        measurand: "Current.Import"
      },
      {
        unit: "A",
        phase: "L3",
        value: "0.00",
        location: "Outlet",
        measurand: "Current.Import"
      },
      {
        unit: "W",
        value: "0",
        location: "Outlet",
        measurand: "Power.Active.Import"
      },
      {
        unit: "Percent",
        value: "0",
        location: "EV",
        measurand: "SoC"
      },
      {
        unit: "W",
        value: "22687",
        location: "Outlet",
        measurand: "Power.Offered"
      },
      {
        unit: "Wh",
        value: "3938330",
        location: "Outlet",
        measurand: "Energy.Active.Import.Register"
      }
    ]
  };

  // Send the detailed meter values
  chargePoint.sendDetailedMeterValue(connectorId, detailedMeterValue);
}
