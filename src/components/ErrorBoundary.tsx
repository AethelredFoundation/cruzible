/**
 * Error Boundary Component
 * Catches JavaScript errors anywhere in the child component tree
 * and displays a fallback UI instead of crashing the app
 */

import React, { Component, ErrorInfo, ReactNode } from "react";
import { AlertTriangle, RefreshCw, Home, MessageCircle } from "lucide-react";
import { BRAND } from "@/lib/constants";

interface Props {
  children: ReactNode;
  fallback?: ReactNode;
  onReset?: () => void;
}

interface State {
  hasError: boolean;
  error: Error | null;
  errorInfo: ErrorInfo | null;
}

export class ErrorBoundary extends Component<Props, State> {
  constructor(props: Props) {
    super(props);
    this.state = {
      hasError: false,
      error: null,
      errorInfo: null,
    };
  }

  static getDerivedStateFromError(error: Error): State {
    return {
      hasError: true,
      error,
      errorInfo: null,
    };
  }

  componentDidCatch(error: Error, errorInfo: ErrorInfo): void {
    // Log error to monitoring service
    console.error("ErrorBoundary caught an error:", error, errorInfo);

    this.setState({
      error,
      errorInfo,
    });

    // Send to error tracking service (Sentry)
    if (typeof window !== "undefined" && (window as any).Sentry) {
      (window as any).Sentry.captureException(error, {
        extra: {
          componentStack: errorInfo.componentStack,
        },
      });
    }
  }

  handleReset = (): void => {
    this.props.onReset?.();
    this.setState({
      hasError: false,
      error: null,
      errorInfo: null,
    });
  };

  handleReload = (): void => {
    window.location.reload();
  };

  handleGoHome = (): void => {
    window.location.href = "/";
  };

  render(): ReactNode {
    if (this.state.hasError) {
      // Custom fallback UI
      if (this.props.fallback) {
        return this.props.fallback;
      }

      return (
        <div className="min-h-screen bg-neutral-950 flex items-center justify-center p-4">
          <div className="max-w-lg w-full">
            {/* Error Card */}
            <div className="relative bg-neutral-900/50 border border-red-500/20 rounded-2xl p-8 backdrop-blur-xl">
              {/* Glow Effect */}
              <div className="absolute -inset-px bg-gradient-to-r from-red-500/10 via-transparent to-red-500/10 rounded-2xl blur-sm" />

              <div className="relative">
                {/* Icon */}
                <div className="w-16 h-16 bg-red-500/10 rounded-xl flex items-center justify-center mx-auto mb-6">
                  <AlertTriangle className="w-8 h-8 text-red-400" />
                </div>

                {/* Title */}
                <h1 className="text-2xl font-bold text-white text-center mb-2">
                  Something went wrong
                </h1>

                <p className="text-neutral-400 text-center mb-6">
                  We apologize for the inconvenience. Our team has been notified
                  and is working on a fix.
                </p>

                {/* Error Details (Development Only) */}
                {process.env.NODE_ENV === "development" && this.state.error && (
                  <div className="mb-6 p-4 bg-red-500/5 border border-red-500/10 rounded-lg">
                    <p className="text-red-400 font-mono text-sm mb-2">
                      {this.state.error.toString()}
                    </p>
                    {this.state.errorInfo && (
                      <pre className="text-red-300/60 font-mono text-xs overflow-auto max-h-32">
                        {this.state.errorInfo.componentStack}
                      </pre>
                    )}
                  </div>
                )}

                {/* Action Buttons */}
                <div className="flex flex-col sm:flex-row gap-3">
                  <button
                    onClick={this.handleReset}
                    className="flex-1 flex items-center justify-center gap-2 px-4 py-3 bg-red-500/10 hover:bg-red-500/20 border border-red-500/20 rounded-lg text-red-400 font-medium transition-all"
                  >
                    <RefreshCw className="w-4 h-4" />
                    Try Again
                  </button>

                  <button
                    onClick={this.handleReload}
                    className="flex-1 flex items-center justify-center gap-2 px-4 py-3 bg-neutral-800 hover:bg-neutral-700 rounded-lg text-white font-medium transition-all"
                  >
                    <RefreshCw className="w-4 h-4" />
                    Reload Page
                  </button>
                </div>

                <button
                  onClick={this.handleGoHome}
                  className="w-full mt-3 flex items-center justify-center gap-2 px-4 py-3 text-neutral-400 hover:text-white transition-colors"
                >
                  <Home className="w-4 h-4" />
                  Go to Homepage
                </button>
              </div>
            </div>

            {/* Support Link */}
            <div className="mt-6 text-center">
              <p className="text-neutral-500 text-sm">
                Need help?{" "}
                <a
                  href="https://discord.gg/aethelred"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-red-400 hover:text-red-300 inline-flex items-center gap-1 transition-colors"
                >
                  <MessageCircle className="w-3 h-3" />
                  Contact Support
                </a>
              </p>
            </div>

            {/* Brand */}
            <div className="mt-8 text-center">
              <p className="text-neutral-600 text-xs">
                {BRAND.NAME} v{process.env.NEXT_PUBLIC_APP_VERSION || "1.0.0"}
              </p>
            </div>
          </div>
        </div>
      );
    }

    return this.props.children;
  }
}

/**
 * Section-level Error Boundary
 * For wrapping individual sections that can fail independently
 */
interface SectionErrorBoundaryProps {
  children: ReactNode;
  sectionName: string;
}

export class SectionErrorBoundary extends Component<
  SectionErrorBoundaryProps,
  State
> {
  constructor(props: SectionErrorBoundaryProps) {
    super(props);
    this.state = {
      hasError: false,
      error: null,
      errorInfo: null,
    };
  }

  static getDerivedStateFromError(error: Error): State {
    return {
      hasError: true,
      error,
      errorInfo: null,
    };
  }

  componentDidCatch(error: Error, errorInfo: ErrorInfo): void {
    console.error(
      `Error in section "${this.props.sectionName}":`,
      error,
      errorInfo,
    );
    this.setState({ error, errorInfo });
  }

  handleRetry = (): void => {
    this.setState({
      hasError: false,
      error: null,
      errorInfo: null,
    });
  };

  render(): ReactNode {
    if (this.state.hasError) {
      return (
        <div className="p-6 bg-red-500/5 border border-red-500/20 rounded-xl">
          <div className="flex items-center gap-3 mb-3">
            <AlertTriangle className="w-5 h-5 text-red-400" />
            <h3 className="text-white font-medium">
              Failed to load {this.props.sectionName}
            </h3>
          </div>
          <p className="text-neutral-400 text-sm mb-4">
            There was an error loading this section. You can try refreshing it.
          </p>
          <button
            onClick={this.handleRetry}
            className="flex items-center gap-2 px-4 py-2 bg-red-500/10 hover:bg-red-500/20 border border-red-500/20 rounded-lg text-red-400 text-sm transition-all"
          >
            <RefreshCw className="w-4 h-4" />
            Retry
          </button>
        </div>
      );
    }

    return this.props.children;
  }
}

export default ErrorBoundary;
