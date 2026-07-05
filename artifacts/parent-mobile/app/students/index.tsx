import { Ionicons } from "@expo/vector-icons";
import {
  useListParentStudents,
  getListParentStudentsQueryKey,
} from "@workspace/api-client-react";
import * as Haptics from "expo-haptics";
import { router } from "expo-router";
import React, { useState } from "react";
import {
  ActivityIndicator,
  FlatList,
  Platform,
  Pressable,
  RefreshControl,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { useAuth } from "@/context/AuthContext";
import { useColors } from "@/hooks/useColors";

function StudentCard({
  student,
}: {
  student: { id: number; name: string; grade: string; relationship: string };
}) {
  const colors = useColors();
  const initial = student.name.charAt(0).toUpperCase();

  return (
    <Pressable
      testID={`student-card-${student.id}`}
      onPress={() => {
        Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
        router.push(`/students/${student.id}`);
      }}
      style={({ pressed }) => [
        styles(colors).card,
        pressed && { opacity: 0.75 },
      ]}
    >
      <View style={styles(colors).avatarContainer}>
        <Text style={styles(colors).avatarText}>{initial}</Text>
      </View>
      <View style={styles(colors).cardContent}>
        <Text style={styles(colors).studentName}>{student.name}</Text>
        <Text style={styles(colors).studentMeta}>
          Grade {student.grade} · <Text style={{ textTransform: "capitalize" }}>{student.relationship}</Text>
        </Text>
      </View>
      <Ionicons name="chevron-forward" size={20} color={colors.mutedForeground} />
    </Pressable>
  );
}

function SkeletonCard() {
  const colors = useColors();
  return (
    <View style={[styles(colors).card, { opacity: 0.5 }]}>
      <View style={[styles(colors).avatarContainer, { backgroundColor: colors.muted }]} />
      <View style={styles(colors).cardContent}>
        <View style={{ height: 16, width: 140, backgroundColor: colors.muted, borderRadius: 4, marginBottom: 6 }} />
        <View style={{ height: 13, width: 100, backgroundColor: colors.muted, borderRadius: 4 }} />
      </View>
    </View>
  );
}

export default function StudentsScreen() {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const { logout, user } = useAuth();
  const [isRefreshing, setIsRefreshing] = useState(false);

  const { data, isLoading, isError, refetch } = useListParentStudents({
    query: { queryKey: getListParentStudentsQueryKey() },
  });

  const students = data?.items ?? [];

  const handleRefresh = async () => {
    setIsRefreshing(true);
    await refetch();
    setIsRefreshing(false);
  };

  const handleLogout = async () => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    await logout();
    router.replace("/login");
  };

  const s = styles(colors);

  return (
    <View style={[s.container, { backgroundColor: colors.background }]}>
      <View
        style={[
          s.header,
          {
            paddingTop: Platform.OS === "web" ? 67 : insets.top + 12,
          },
        ]}
      >
        <View>
          <Text style={s.headerTitle}>My Students</Text>
          {user?.displayName && (
            <Text style={s.headerSubtitle}>Welcome, {user.displayName}</Text>
          )}
        </View>
        <Pressable
          onPress={handleLogout}
          style={({ pressed }) => [s.logoutButton, pressed && { opacity: 0.6 }]}
          testID="logout-button"
        >
          <Ionicons name="log-out-outline" size={22} color={colors.mutedForeground} />
        </Pressable>
      </View>

      {isLoading ? (
        <View style={s.listContent}>
          {[1, 2, 3].map((i) => <SkeletonCard key={i} />)}
        </View>
      ) : isError ? (
        <View style={s.centered}>
          <Ionicons name="alert-circle-outline" size={48} color={colors.mutedForeground} />
          <Text style={s.emptyTitle}>Could not load students</Text>
          <Pressable
            onPress={() => refetch()}
            style={[s.retryButton, { backgroundColor: colors.primary }]}
          >
            <Text style={[s.retryText, { color: colors.primaryForeground }]}>Try Again</Text>
          </Pressable>
        </View>
      ) : students.length === 0 ? (
        <View style={s.centered}>
          <View style={[s.emptyIcon, { backgroundColor: colors.muted }]}>
            <Ionicons name="people-outline" size={36} color={colors.mutedForeground} />
          </View>
          <Text style={s.emptyTitle}>No students linked</Text>
          <Text style={s.emptySubtitle}>
            Contact your school administrator to link student accounts.
          </Text>
        </View>
      ) : (
        <FlatList
          data={students}
          keyExtractor={(item) => String(item.id)}
          renderItem={({ item }) => <StudentCard student={item} />}
          contentContainerStyle={[
            s.listContent,
            { paddingBottom: Platform.OS === "web" ? 34 : insets.bottom + 16 },
          ]}
          refreshControl={
            <RefreshControl
              refreshing={isRefreshing}
              onRefresh={handleRefresh}
              tintColor={colors.primary}
            />
          }
          scrollEnabled={!!students.length}
          showsVerticalScrollIndicator={false}
        />
      )}
    </View>
  );
}

const styles = (colors: ReturnType<typeof useColors>) =>
  StyleSheet.create({
    container: {
      flex: 1,
    },
    header: {
      flexDirection: "row",
      alignItems: "flex-end",
      justifyContent: "space-between",
      paddingHorizontal: 20,
      paddingBottom: 16,
      borderBottomWidth: 1,
      borderBottomColor: colors.border,
      backgroundColor: colors.background,
    },
    headerTitle: {
      fontSize: 28,
      fontFamily: "Inter_700Bold",
      color: colors.foreground,
      letterSpacing: -0.5,
    },
    headerSubtitle: {
      fontSize: 13,
      fontFamily: "Inter_400Regular",
      color: colors.mutedForeground,
      marginTop: 2,
    },
    logoutButton: {
      width: 40,
      height: 40,
      borderRadius: 20,
      backgroundColor: colors.muted,
      alignItems: "center",
      justifyContent: "center",
    },
    listContent: {
      padding: 16,
      gap: 10,
    },
    card: {
      flexDirection: "row",
      alignItems: "center",
      backgroundColor: colors.card,
      borderRadius: colors.radius + 4,
      padding: 16,
      borderWidth: 1,
      borderColor: colors.border,
      gap: 14,
    },
    avatarContainer: {
      width: 46,
      height: 46,
      borderRadius: 23,
      backgroundColor: colors.primary + "20",
      alignItems: "center",
      justifyContent: "center",
    },
    avatarText: {
      fontSize: 18,
      fontFamily: "Inter_700Bold",
      color: colors.primary,
    },
    cardContent: {
      flex: 1,
    },
    studentName: {
      fontSize: 16,
      fontFamily: "Inter_600SemiBold",
      color: colors.foreground,
      marginBottom: 3,
    },
    studentMeta: {
      fontSize: 13,
      fontFamily: "Inter_400Regular",
      color: colors.mutedForeground,
    },
    centered: {
      flex: 1,
      alignItems: "center",
      justifyContent: "center",
      padding: 32,
      gap: 12,
    },
    emptyIcon: {
      width: 72,
      height: 72,
      borderRadius: 36,
      alignItems: "center",
      justifyContent: "center",
      marginBottom: 4,
    },
    emptyTitle: {
      fontSize: 17,
      fontFamily: "Inter_600SemiBold",
      color: colors.foreground,
      textAlign: "center",
    },
    emptySubtitle: {
      fontSize: 14,
      fontFamily: "Inter_400Regular",
      color: colors.mutedForeground,
      textAlign: "center",
      lineHeight: 20,
    },
    retryButton: {
      paddingHorizontal: 20,
      paddingVertical: 10,
      borderRadius: colors.radius,
      marginTop: 4,
    },
    retryText: {
      fontSize: 15,
      fontFamily: "Inter_600SemiBold",
    },
  });
