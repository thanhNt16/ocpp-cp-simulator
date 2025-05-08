import {Connector} from "./Connector";
import {OCPPWebSocket} from "./OCPPWebSocket";
import {OCPPMessageHandler} from "./OCPPMessageHandler";
import {Logger} from "./Logger";
import {OCPPStatus, OCPPAvailability, BootNotification} from "./OcppTypes";
import {Transaction} from "./Transaction.ts";
import * as ocpp from "./OcppTypes.ts";

export class ChargePoint {
  private _id: string;
  private _bootNotification: ocpp.BootNotification;
  private _connectors: Map<number, Connector>;
  private _webSocket: OCPPWebSocket;
  private _messageHandler: OCPPMessageHandler;
  private _logger: Logger;
  private _autoMeterValueSetting: { interval: number; value: number } | null;

  public _status: OCPPStatus = OCPPStatus.Unavailable;
  private _error: string = "";
  public _errorCallback: (error: string) => void = () => {
  };

  private _heartbeat: number | null = null;
  private _autoMeterValueIntervals: Map<number, number> = new Map();

  private _statusChangeCallback:
    | ((status: string, message?: string) => void)
    | null = null;
  private _availabilityChangeCallbacks: Map<
    number,
    (availability: OCPPAvailability) => void
  > = new Map();

  constructor(id: string,
              _bootNotification: BootNotification,
              connectorCount: number,
              wsUrl: string,
              basicAuthSettings: { username: string; password: string } | null,
              autoMeterValueSetting: { interval: number; value: number } | null) {
    this._id = id;
    this._bootNotification = _bootNotification;
    this._connectors = new Map();
    for (let i = 1; i <= connectorCount; i++) {
      this._connectors.set(i, new Connector(i));
    }
    this._logger = new Logger();
    this._webSocket = new OCPPWebSocket(wsUrl, this._id, this._logger, basicAuthSettings);
    this._messageHandler = new OCPPMessageHandler(
      this,
      this._webSocket,
      this._logger
    );
    this._autoMeterValueSetting = autoMeterValueSetting;
  }

  // Getters
  get id(): string {
    return this._id;
  }

  get status(): OCPPStatus {
    return this._status;
  }

  get connectorNumber(): number {
    return this._connectors.size;
  }

  get wsUrl(): string {
    return this._webSocket.url;
  }

  get error(): string {
    return this._error;
  }

  set error(error: string) {
    this._error = error;
    this._errorCallback(error);
  }

  set errorCallback(callback: (error: string) => void) {
    this._errorCallback = callback;
  }

  get connectors(): Map<number, Connector> {
    return new Map(this._connectors);
  }

  // Setters and getters for callbacks
  set statusChangeCallback(
    callback: (status: string, message?: string) => void
  ) {
    this._statusChangeCallback = callback;
  }

  set loggingCallback(callback: (message: string) => void) {
    this._logger._loggingCallback = callback;
  }

  setConnectorTransactionIDChangeCallback(
    connectorId: number,
    callback: (transactionId: number | null) => void
  ): void {
    this.connectors.get(connectorId)?.setTransactionIDChangeCallbacks(callback);
  }

  setConnectorStatusChangeCallback(
    connectorId: number,
    callback: (status: ocpp.OCPPStatus) => void
  ): void {
    this.connectors.get(connectorId)?.setStatusChangeCallbacks(callback);
  }

  setConnectorMeterValueChangeCallback(
    connectorId: number,
    callback: (meterValue: number) => void
  ): void {
    this.connectors.get(connectorId)?.setMeterValueChangeCallbacks(callback);
  }

  setAvailabilityChangeCallback(
    connectorId: number,
    callback: (availability: OCPPAvailability) => void
  ): void {
    this._availabilityChangeCallbacks.set(connectorId, callback);
  }

  public connect(): void {
    this._webSocket.connect(
      () => this.boot(),
      (ev: CloseEvent) => {
        this.status = OCPPStatus.Unavailable;
        this.updateAllConnectorsStatus(OCPPStatus.Unavailable);
        this._logger.error(
          `WebSocket closed code: ${ev.code} reason: ${ev.reason}`
        );
        if (ev.code !== 1005) {
          this.error = `WebSocket closed code: ${ev.code} reason: ${ev.reason}`;
        }
      }
    );
  }

  public boot(): void {
    this._messageHandler.sendBootNotification(this._bootNotification);
    this.status = OCPPStatus.Available;
    this.updateAllConnectorsStatus(OCPPStatus.Available);
    this.error = "";
  }

  public disconnect(): void {
    this._logger.info("Disconnecting from WebSocket");
    this._status = OCPPStatus.Unavailable;
    this._webSocket.disconnect();
  }

  public reset(): void {
    this.disconnect();
    this.connect();
  }

  public authorize(tagId: string): void {
    this._messageHandler.authorize(tagId);
  }

  set status(status: OCPPStatus) {
    this._status = status;
    if (this._statusChangeCallback) {
      this._statusChangeCallback(status);
    }
  }

  public startTransaction(tagId: string, connectorId: number): void {
    const connector = this.getConnector(connectorId);
    if (connector) {
      const transaction: Transaction = {
        id: 0,
        connectorId: connectorId,
        tagId: tagId,
        meterStart: 0,
        meterStop: null,
        startTime: new Date(),
        stopTime: null,
        meterSent: false,
      };
      connector.transaction = transaction;
      this._messageHandler.startTransaction(transaction, connectorId);
      this.updateConnectorStatus(connectorId, OCPPStatus.Preparing);
      if (this._autoMeterValueSetting !== null &&
        this._autoMeterValueSetting.interval !== 0 &&
        this._autoMeterValueSetting.value !== 0) {
        this.startAutoMeterValue(connectorId, this._autoMeterValueSetting.interval, this._autoMeterValueSetting.value);
      }
    } else {
      this._logger.error(`Connector ${connectorId} not found`);
    }
  }

  public stopTransaction(connectorId: number | Connector): void {
    let connId: number;
    let connector: Connector | undefined;
    if (typeof connectorId === 'number') {
      connId = connectorId;
      connector = this.getConnector(connectorId);
    } else {
      connId = connectorId.id;
      connector = connectorId;
    }
    if (connector) {
      connector.transaction!.stopTime = new Date();
      connector.transaction!.meterStop = connector.meterValue;
      this._messageHandler.stopTransaction(
        connector.transaction!,
        connId
      );
      this.cleanTransaction(connector);
    } else {
      this._logger.error(`Connector for id ${connId} not found`);
    }
    this.updateConnectorStatus(connId, OCPPStatus.Available);
  }

  public cleanTransaction(connector: Connector | number): void {
    let connectorId: number;
    let transaction: Transaction | undefined | null;
    if (typeof connector === 'number') {
      connectorId = connector;
      transaction = this.getConnector(connectorId)?.transaction;
    } else {
      connectorId = connector.id;
      transaction = connector.transaction;
    }
    if (transaction) {
      transaction.meterSent = false;
    }
    this.updateConnectorStatus(connectorId, OCPPStatus.Finishing);
    this._autoMeterValueSetting && this.stopAutoMeterValue(connectorId);
  }

  public sendHeartbeat(): void {
    this._messageHandler.sendHeartbeat();
  }

  public startHeartbeat(period: number): void {
    this._logger.info("Setting heartbeat period to " + period + "s");
    if (this._heartbeat) {
      clearInterval(this._heartbeat);
    }
    this._heartbeat = setInterval(() => this.sendHeartbeat(), period * 1000);
  }

  public stopHeartbeat(): void {
    this._logger.info("Stopping heartbeat");
    if (this._heartbeat) {
      clearInterval(this._heartbeat);
    }
  }

  public setMeterValue(connectorId: number, meterValue: number): void {
    const connector = this.getConnector(connectorId);
    if (connector) {
      connector.meterValue = meterValue;
    } else {
      this._logger.error(`Connector ${connectorId} not found`);
    }
  }

  public sendMeterValue(connectorId: number): void {
    const connector = this.getConnector(connectorId);
    if (connector) {
      // Use detailed meter values by default
      const detailedMeterValues = this.generateDetailedMeterValues(connector.meterValue);
      this.sendDetailedMeterValue(connectorId, detailedMeterValues);
    } else {
      this._logger.error(`Connector ${connectorId} not found`);
    }
  }

  /**
   * Sends detailed meter values for a connector
   * @param connectorId The connector ID
   * @param meterValueData The detailed meter value data
   */
  public sendDetailedMeterValue(connectorId: number, meterValueData: {
    timestamp?: string,
    sampledValue: Array<{
      value: string,
      context?: "Interruption.Begin" | "Interruption.End" | "Sample.Clock" | "Sample.Periodic" | "Transaction.Begin" | "Transaction.End" | "Trigger" | "Other",
      format?: "Raw" | "SignedData",
      measurand?: "Energy.Active.Export.Register" | "Energy.Active.Import.Register" | "Energy.Reactive.Export.Register" | "Energy.Reactive.Import.Register" | "Energy.Active.Export.Interval" | "Energy.Active.Import.Interval" | "Energy.Reactive.Export.Interval" | "Energy.Reactive.Import.Interval" | "Power.Active.Export" | "Power.Active.Import" | "Power.Offered" | "Power.Reactive.Export" | "Power.Reactive.Import" | "Power.Factor" | "Current.Import" | "Current.Export" | "Current.Offered" | "Voltage" | "Frequency" | "Temperature" | "SoC" | "RPM",
      phase?: "L1" | "L2" | "L3" | "N" | "L1-N" | "L2-N" | "L3-N" | "L1-L2" | "L2-L3" | "L3-L1",
      location?: "Cable" | "EV" | "Inlet" | "Outlet" | "Body",
      unit?: "Wh" | "kWh" | "varh" | "kvarh" | "W" | "kW" | "VA" | "kVA" | "var" | "kvar" | "A" | "V" | "K" | "Celcius" | "Fahrenheit" | "Percent"
    }>
  }): void {
    const connector = this.getConnector(connectorId);
    if (connector) {
      this._messageHandler.sendMeterValue(connector.transaction?.id ?? undefined, connectorId, meterValueData);
    } else {
      this._logger.error(`Connector ${connectorId} not found`);
    }
  }

  /**
   * Sends a detailed meter value with the current format including voltage, current, power, and energy readings
   * @param connectorId The connector ID
   */
  public sendCurrentDetailedMeterValue(connectorId: number): void {
    const connector = this.getConnector(connectorId);
    if (connector) {
      const detailedMeterValues = this.generateDetailedMeterValues(connector.meterValue);
      this.sendDetailedMeterValue(connectorId, detailedMeterValues);
    } else {
      this._logger.error(`Connector ${connectorId} not found`);
    }
  }

  /**
   * Generates detailed meter values with voltage, current, power, and energy readings
   * @param meterValue The current meter value
   * @returns A detailed meter value object
   */
  private generateDetailedMeterValues(meterValue: number) {
    return {
      timestamp: new Date().toISOString(),
      sampledValue: [
        {
          unit: "V" as "V",
          phase: "L1" as "L1",
          value: "236.7",
          location: "Outlet" as "Outlet",
          measurand: "Voltage" as "Voltage"
        },
        {
          unit: "V" as "V",
          phase: "L2" as "L2",
          value: "235.6",
          location: "Outlet" as "Outlet",
          measurand: "Voltage" as "Voltage"
        },
        {
          unit: "V" as "V",
          phase: "L3" as "L3",
          value: "236.7",
          location: "Outlet" as "Outlet",
          measurand: "Voltage" as "Voltage"
        },
        {
          unit: "A" as "A",
          phase: "L1" as "L1",
          value: "0.00",
          location: "Outlet" as "Outlet",
          measurand: "Current.Import" as "Current.Import"
        },
        {
          unit: "A" as "A",
          phase: "L2" as "L2",
          value: "0.00",
          location: "Outlet" as "Outlet",
          measurand: "Current.Import" as "Current.Import"
        },
        {
          unit: "A" as "A",
          phase: "L3" as "L3",
          value: "0.00",
          location: "Outlet" as "Outlet",
          measurand: "Current.Import" as "Current.Import"
        },
        {
          unit: "W" as "W",
          value: "2000",
          location: "Outlet" as "Outlet",
          measurand: "Power.Active.Import" as "Power.Active.Import"
        },
        {
          unit: "Percent" as "Percent",
          value: "10",
          location: "EV" as "EV",
          measurand: "SoC" as "SoC"
        },
        {
          unit: "W" as "W",
          value: "22687",
          location: "Outlet" as "Outlet",
          measurand: "Power.Offered" as "Power.Offered"
        },
        {
          unit: "Wh" as "Wh",
          value: meterValue.toString(),
          location: "Outlet" as "Outlet",
          measurand: "Energy.Active.Import.Register" as "Energy.Active.Import.Register"
        }
      ]
    };
  }

  public startAutoMeterValue(connectorId: number, intervalSec: number, value: number): void {
    const intervalNum = setInterval(() => {
      const connector = this.getConnector(connectorId);
      if (connector) {
        // Update the meter value
        this.setMeterValue(connectorId, connector.meterValue + value);

        // Send detailed meter values
        const detailedMeterValues = this.generateDetailedMeterValues(connector.meterValue);
        this.sendDetailedMeterValue(connectorId, detailedMeterValues);
      }
    }, intervalSec * 1000);
    this._autoMeterValueIntervals.set(connectorId, intervalNum);
  }

  public stopAutoMeterValue(connectorId: number): void {
    const intervalNum = this._autoMeterValueIntervals.get(connectorId);
    if (intervalNum) {
      clearInterval(intervalNum);
      this._autoMeterValueIntervals.delete(connectorId);
    }
  }

  public getConnector(connectorId: number): Connector | undefined {
    return this._connectors.get(connectorId);
  }

  public updateAllConnectorsStatus(newStatus: OCPPStatus): void {
    this._connectors.forEach((connector) => {
      connector.status = newStatus;
      this.connectors.forEach((connector) => {
        connector.status = newStatus;
      });
      this._messageHandler.sendStatusNotification(connector.id, newStatus);
    });
  }

  public updateConnectorStatus(
    connectorId: number,
    newStatus: OCPPStatus
  ): void {
    const connector = this.getConnector(connectorId);
    if (connector) {
      connector.status = newStatus;
      this._messageHandler.sendStatusNotification(connectorId, newStatus);
    } else {
      this._logger.error(`Connector ${connectorId} not found`);
    }
  }

  public updateConnectorAvailability(
    connectorId: number,
    newAvailability: OCPPAvailability
  ): boolean {
    const connector = this.getConnector(connectorId);
    if (!connector) {
      this._logger.error(`Connector ${connectorId} not found`);
      return false;
    }
    connector.availability = newAvailability;
    if (newAvailability === "Inoperative") {
      this.updateConnectorStatus(connectorId, OCPPStatus.Unavailable);
    } else if (newAvailability === "Operative") {
      this.updateConnectorStatus(connectorId, OCPPStatus.Available);
    }
    const callback = this._availabilityChangeCallbacks.get(connectorId);
    if (callback) {
      callback(newAvailability);
    }
    return true;
  }

  public setTransactionID(connectorId: number, transactionId: number): void {
    const connector = this.getConnector(connectorId);
    if (connector) {
      connector.transactionId = transactionId;
    } else {
      this._logger.error(`Connector ${connectorId} not found`);
    }
  }
}
