import React, { createContext, useCallback, useContext, useEffect, useRef, useState } from "react";
import * as Notifications from "expo-notifications";
import { Platform } from "react-native";

export interface AuthUser {
  id: number;
  username: string;
  role: string;
  displayName?: string | null;
}

interface AuthContextValue {
  user: AuthUser | null;
  isLoading: boolean;
  login: (username: string, password: string) => Promise<void>;
  logout: () => Promise<void>;
}

const AuthContext = createContext<AuthContextValue | null>(null);

function buildApiUrl(path: string): string {
  const domain = process.env.EXPO_PUBLIC_DOMAIN;
  if (!domain) return path;
  return `https://${domain}${path}`;
}

Notifications.setNotificationHandler({
  handleNotification: async () => ({
    shouldShowAlert: true,
    shouldPlaySound: true,
    shouldSetBadge: false,
    shouldShowBanner: true,
    shouldShowList: true,
  }),
});

async function registerPushToken(apiUrl: (path: string) => string): Promise<void> {
  if (Platform.OS === "web") return;

  try {
    type PermResult = { granted: boolean; canAskAgain: boolean };
    const existing = (await Notifications.getPermissionsAsync()) as unknown as PermResult;
    let granted = existing.granted;

    if (!granted && existing.canAskAgain) {
      const result = (await Notifications.requestPermissionsAsync()) as unknown as PermResult;
      granted = result.granted;
    }

    if (!granted) return;

    const tokenData = await Notifications.getExpoPushTokenAsync();
    const token = tokenData.data;

    await fetch(apiUrl("/api/parent/push-token"), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      credentials: "include",
      body: JSON.stringify({ token }),
    });
  } catch {
  }
}

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<AuthUser | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const notificationListener = useRef<Notifications.EventSubscription | null>(null);
  const responseListener = useRef<Notifications.EventSubscription | null>(null);

  const checkAuth = useCallback(async () => {
    try {
      const res = await fetch(buildApiUrl("/api/auth/me"), {
        credentials: "include",
      });
      if (res.ok) {
        const data = await res.json();
        setUser(data);
      } else {
        setUser(null);
      }
    } catch {
      setUser(null);
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    checkAuth();
  }, [checkAuth]);

  useEffect(() => {
    notificationListener.current = Notifications.addNotificationReceivedListener(
      (_notification) => {},
    );

    return () => {
      notificationListener.current?.remove();
    };
  }, []);

  useEffect(() => {
    responseListener.current = Notifications.addNotificationResponseReceivedListener(
      (_response) => {},
    );

    return () => {
      responseListener.current?.remove();
    };
  }, []);

  const login = useCallback(async (username: string, password: string) => {
    const res = await fetch(buildApiUrl("/api/auth/login"), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      credentials: "include",
      body: JSON.stringify({ username, password }),
    });
    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      throw new Error((data as { error?: string }).error ?? "Login failed");
    }
    const data = await res.json();
    setUser(data);

    void registerPushToken(buildApiUrl);
  }, []);

  const logout = useCallback(async () => {
    try {
      await fetch(buildApiUrl("/api/auth/logout"), {
        method: "POST",
        credentials: "include",
      });
    } catch {
    }
    setUser(null);
  }, []);

  return (
    <AuthContext.Provider value={{ user, isLoading, login, logout }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used within AuthProvider");
  return ctx;
}
