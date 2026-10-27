import { Component, type ErrorInfo, type ReactNode } from "react";
import { Download, RefreshCw, TriangleAlert } from "lucide-react";
import { downloadFile, localIsoDate } from "./lib/format";
import { readValue } from "./lib/persistentStore";
import { TRANSACTIONS_STORAGE_KEY } from "./lib/transactionStorage";

interface Props {
  children: ReactNode;
}

interface State {
  error: Error | null;
  downloading: boolean;
  note: string;
}

/**
 * Keeps a crash from leaving the user with a blank page and no way to reach the
 * history stored in this browser.
 */
export default class ErrorBoundary extends Component<Props, State> {
  state: State = { error: null, downloading: false, note: "" };

  static getDerivedStateFromError(error: Error): Partial<State> {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error("Spendwise stopped unexpectedly", error, info.componentStack);
  }

  private downloadSavedData = async () => {
    this.setState({ downloading: true, note: "" });
    try {
      const transactions = await readValue(TRANSACTIONS_STORAGE_KEY);
      const payload = {
        exportedAt: new Date().toISOString(),
        note: "Spendwise recovery export after an unexpected error.",
        transactionHistory: transactions,
      };
      downloadFile(
        JSON.stringify(payload, null, 2),
        `spendwise-recovery-${localIsoDate()}.json`,
        "application/json",
      );
      this.setState({ downloading: false, note: "Saved data downloaded. Keep the file somewhere safe." });
    } catch {
      this.setState({
        downloading: false,
        note: "Could not read saved data from this screen. Try exporting the browser's site data instead.",
      });
    }
  };

  render() {
    if (!this.state.error) return this.props.children;

    return (
      <div className="crash-screen">
        <div className="crash-card">
          <div className="crash-icon"><TriangleAlert size={22} /></div>
          <h1>Spendwise hit an unexpected error</h1>
          <p>
            Your saved transactions are still in this browser. Reload to try again, or download
            a copy before troubleshooting.
          </p>
          {this.state.note && <p className="crash-note">{this.state.note}</p>}
          <div className="crash-actions">
            <button className="button button-primary" onClick={() => window.location.reload()}>
              <RefreshCw size={15} /> Reload
            </button>
            <button
              className="button button-secondary"
              onClick={() => void this.downloadSavedData()}
              disabled={this.state.downloading}
            >
              <Download size={15} /> {this.state.downloading ? "Preparing…" : "Download saved data"}
            </button>
          </div>
          <details className="crash-details">
            <summary>Error details</summary>
            <pre>{this.state.error.message}</pre>
          </details>
        </div>
      </div>
    );
  }
}
