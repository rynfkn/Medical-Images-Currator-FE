import axios from "axios";

const TOKEN_KEY = "medical-curator-token";
export const SESSION_EXPIRED = "medical-curator-session-expired";
export const getToken = () => localStorage.getItem(TOKEN_KEY);
export const setToken = (token: string) =>
  localStorage.setItem(TOKEN_KEY, token);
export const clearToken = () => localStorage.removeItem(TOKEN_KEY);

export const api = axios.create({
  baseURL: (import.meta.env.VITE_API_BASE_URL?.trim() || "/api/v1").replace(
    /\/+$/,
    "",
  ),
});

api.interceptors.request.use((config) => {
  const token = getToken();
  if (token) config.headers.Authorization = `Bearer ${token}`;
  return config;
});
api.interceptors.response.use(
  (response) => {
    // A SPA rewrite or tunnel interstitial can return HTTP 200 with HTML.
    if (String(response.headers["content-type"]).includes("text/html"))
      throw new axios.AxiosError(
        "The API returned HTML instead of data.",
        "ERR_API_HTML",
        response.config,
        response.request,
        response,
      );
    return response;
  },
  (error: unknown) => {
    if (axios.isAxiosError(error) && error.response?.status === 401) {
      clearToken();
      window.dispatchEvent(new Event(SESSION_EXPIRED));
    }
    return Promise.reject(error);
  },
);

export function errorMessage(error: unknown, fallback: string): string {
  if (!axios.isAxiosError(error)) return fallback;
  if (error.code === "ERR_API_HTML")
    return "The server returned a web page instead of API data. Please contact the deployment administrator.";
  const detail: unknown = error.response?.data?.detail;
  // Never render server HTML, tracebacks, or unstructured error bodies.
  if (
    typeof detail === "string" &&
    detail.length < 500 &&
    !/[<>\n]/.test(detail)
  )
    return detail;
  if (Array.isArray(detail)) return "Please check the input and try again.";
  if (!error.response)
    return "Cannot reach the server. Check your connection and try again.";
  return fallback;
}

// Backend file URLs are /api/v1/... even when the API is hosted on another origin.
// Only accept API-relative paths so bearer tokens cannot leak to third-party URLs.
export function filePath(url: string): string {
  if (!url.startsWith("/api/v1/files/"))
    throw new Error("Unsupported file URL");
  return url.slice("/api/v1".length);
}

export async function getFile(
  url: string,
  signal?: AbortSignal,
): Promise<Blob> {
  const response = await api.get<Blob>(filePath(url), {
    responseType: "blob",
    signal,
  });
  return response.data;
}
