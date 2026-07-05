import { Ionicons } from "@expo/vector-icons";
import {
  useGetParentStudentProgress,
  getGetParentStudentProgressQueryKey,
  useListParentStudentAssignments,
  getListParentStudentAssignmentsQueryKey,
  useListParentStudentAssessments,
  getListParentStudentAssessmentsQueryKey,
  useListParentStudents,
  getListParentStudentsQueryKey,
} from "@workspace/api-client-react";
import { router, useLocalSearchParams } from "expo-router";
import React, { useState } from "react";
import {
  ActivityIndicator,
  FlatList,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { useColors } from "@/hooks/useColors";

type TabId = "overview" | "assignments" | "assessments";

function StatCard({ label, value, sub }: { label: string; value: string; sub?: string }) {
  const colors = useColors();
  return (
    <View style={[statStyles(colors).card, { backgroundColor: colors.card, borderColor: colors.border }]}>
      <Text style={statStyles(colors).label}>{label}</Text>
      <Text style={statStyles(colors).value}>{value}</Text>
      {sub && <Text style={statStyles(colors).sub}>{sub}</Text>}
    </View>
  );
}

const statStyles = (colors: ReturnType<typeof useColors>) =>
  StyleSheet.create({
    card: {
      flex: 1,
      borderRadius: 12,
      padding: 14,
      borderWidth: 1,
      minWidth: 80,
    },
    label: {
      fontSize: 10,
      fontFamily: "Inter_600SemiBold",
      color: colors.mutedForeground,
      textTransform: "uppercase",
      letterSpacing: 0.5,
      marginBottom: 6,
    },
    value: {
      fontSize: 20,
      fontFamily: "Inter_700Bold",
      color: colors.foreground,
      letterSpacing: -0.3,
    },
    sub: {
      fontSize: 11,
      fontFamily: "Inter_400Regular",
      color: colors.mutedForeground,
      marginTop: 2,
    },
  });

function RiskBadge({ level }: { level: string | null | undefined }) {
  const colors = useColors();
  const map: Record<string, { label: string; color: string; bg: string }> = {
    LOW: { label: "Low Risk", color: "#16a34a", bg: "#dcfce7" },
    MEDIUM: { label: "Med Risk", color: "#d97706", bg: "#fef3c7" },
    HIGH: { label: "High Risk", color: colors.destructive, bg: colors.destructive + "15" },
    INSUFFICIENT_DATA: { label: "No data", color: colors.mutedForeground, bg: colors.muted },
  };
  const cfg = map[level ?? "INSUFFICIENT_DATA"] ?? map["INSUFFICIENT_DATA"];
  return (
    <View style={{ backgroundColor: cfg.bg, borderRadius: 6, paddingHorizontal: 8, paddingVertical: 3, alignSelf: "flex-start" }}>
      <Text style={{ fontSize: 12, fontFamily: "Inter_600SemiBold", color: cfg.color }}>{cfg.label}</Text>
    </View>
  );
}

function TrendIcon({ trend }: { trend: string | null | undefined }) {
  const colors = useColors();
  if (trend === "IMPROVING") return <Ionicons name="trending-up" size={18} color="#16a34a" />;
  if (trend === "DECLINING") return <Ionicons name="trending-down" size={18} color={colors.destructive} />;
  return <Ionicons name="remove" size={18} color={colors.mutedForeground} />;
}

function StatusBadge({ status }: { status: string }) {
  const colors = useColors();
  const map: Record<string, { bg: string; color: string }> = {
    graded: { bg: colors.primary + "20", color: colors.primary },
    submitted: { bg: colors.accent, color: colors.accentForeground },
    pending: { bg: colors.muted, color: colors.mutedForeground },
    overdue: { bg: colors.destructive + "15", color: colors.destructive },
  };
  const cfg = map[status] ?? map["pending"];
  return (
    <View style={{ backgroundColor: cfg.bg, borderRadius: 5, paddingHorizontal: 7, paddingVertical: 3 }}>
      <Text style={{ fontSize: 11, fontFamily: "Inter_600SemiBold", color: cfg.color, textTransform: "capitalize" }}>
        {status}
      </Text>
    </View>
  );
}

function TopicPill({ text, color }: { text: string; color: string }) {
  const colors = useColors();
  return (
    <View style={{
      flexDirection: "row",
      alignItems: "center",
      gap: 6,
      paddingVertical: 8,
      borderBottomWidth: 1,
      borderBottomColor: colors.border,
    }}>
      <View style={{ width: 8, height: 8, borderRadius: 4, backgroundColor: color }} />
      <Text style={{ fontSize: 14, fontFamily: "Inter_400Regular", color: colors.foreground, flex: 1 }}>{text}</Text>
    </View>
  );
}

function OverviewTab({ studentId }: { studentId: number }) {
  const colors = useColors();
  const { data: progress, isLoading } = useGetParentStudentProgress(studentId, {
    query: { enabled: !!studentId, queryKey: getGetParentStudentProgressQueryKey(studentId) },
  });

  if (isLoading) {
    return (
      <View style={{ flex: 1, alignItems: "center", justifyContent: "center", padding: 40 }}>
        <ActivityIndicator color={colors.primary} />
      </View>
    );
  }

  if (!progress) {
    return (
      <View style={{ flex: 1, alignItems: "center", justifyContent: "center", padding: 40 }}>
        <Text style={{ fontSize: 14, color: colors.mutedForeground, fontFamily: "Inter_400Regular" }}>No progress data available.</Text>
      </View>
    );
  }

  return (
    <ScrollView
      style={{ flex: 1 }}
      contentContainerStyle={{ padding: 16, gap: 16 }}
      showsVerticalScrollIndicator={false}
    >
      <View style={{ flexDirection: "row", gap: 10 }}>
        <StatCard label="Avg Score" value={`${progress.averageScore.toFixed(1)}%`} />
        <StatCard
          label="Completion"
          value={`${(progress.completionRate * 100).toFixed(0)}%`}
          sub={`${progress.completedAssignments}/${progress.totalAssignments}`}
        />
      </View>
      <View style={{ flexDirection: "row", gap: 10, alignItems: "stretch" }}>
        <View style={{ flex: 1, backgroundColor: colors.card, borderRadius: 12, padding: 14, borderWidth: 1, borderColor: colors.border }}>
          <Text style={{ fontSize: 10, fontFamily: "Inter_600SemiBold", color: colors.mutedForeground, textTransform: "uppercase", letterSpacing: 0.5, marginBottom: 8 }}>Risk Level</Text>
          <RiskBadge level={progress.riskLevel} />
        </View>
        <View style={{ flex: 1, backgroundColor: colors.card, borderRadius: 12, padding: 14, borderWidth: 1, borderColor: colors.border }}>
          <Text style={{ fontSize: 10, fontFamily: "Inter_600SemiBold", color: colors.mutedForeground, textTransform: "uppercase", letterSpacing: 0.5, marginBottom: 8 }}>Trend</Text>
          <View style={{ flexDirection: "row", alignItems: "center", gap: 6 }}>
            <TrendIcon trend={progress.trend} />
            <Text style={{ fontSize: 13, fontFamily: "Inter_500Medium", color: colors.foreground, textTransform: "capitalize" }}>
              {(progress.trend ?? "stable").toLowerCase().replace("_", " ")}
            </Text>
          </View>
        </View>
      </View>

      <SectionCard title="Topics Mastered" icon="checkmark-circle" iconColor="#16a34a">
        {progress.topicsMastered.length === 0 ? (
          <Text style={{ fontSize: 14, color: colors.mutedForeground, fontFamily: "Inter_400Regular" }}>No data yet</Text>
        ) : (
          progress.topicsMastered.map((t, i) => <TopicPill key={i} text={t} color="#16a34a" />)
        )}
      </SectionCard>

      <SectionCard title="Topics Needing Work" icon="alert-circle" iconColor="#d97706">
        {progress.topicsNeedingWork.length === 0 ? (
          <Text style={{ fontSize: 14, color: colors.mutedForeground, fontFamily: "Inter_400Regular" }}>No data yet</Text>
        ) : (
          progress.topicsNeedingWork.map((t, i) => <TopicPill key={i} text={t} color="#d97706" />)
        )}
      </SectionCard>
    </ScrollView>
  );
}

function SectionCard({ title, icon, iconColor, children }: {
  title: string;
  icon: keyof typeof Ionicons.glyphMap;
  iconColor: string;
  children: React.ReactNode;
}) {
  const colors = useColors();
  return (
    <View style={{ backgroundColor: colors.card, borderRadius: 12, overflow: "hidden", borderWidth: 1, borderColor: colors.border }}>
      <View style={{ flexDirection: "row", alignItems: "center", gap: 8, padding: 14, borderBottomWidth: 1, borderBottomColor: colors.border }}>
        <Ionicons name={icon} size={16} color={iconColor} />
        <Text style={{ fontSize: 14, fontFamily: "Inter_600SemiBold", color: colors.foreground }}>{title}</Text>
      </View>
      <View style={{ padding: 14 }}>
        {children}
      </View>
    </View>
  );
}

function AssignmentsTab({ studentId }: { studentId: number }) {
  const colors = useColors();
  const { data, isLoading } = useListParentStudentAssignments(studentId, {
    query: { enabled: !!studentId, queryKey: getListParentStudentAssignmentsQueryKey(studentId) },
  });

  const items = data?.items ?? [];

  if (isLoading) {
    return (
      <View style={{ flex: 1, alignItems: "center", justifyContent: "center" }}>
        <ActivityIndicator color={colors.primary} />
      </View>
    );
  }

  if (items.length === 0) {
    return (
      <View style={{ flex: 1, alignItems: "center", justifyContent: "center", padding: 40, gap: 12 }}>
        <View style={{ width: 56, height: 56, borderRadius: 28, backgroundColor: colors.muted, alignItems: "center", justifyContent: "center" }}>
          <Ionicons name="checkmark-done-outline" size={28} color={colors.mutedForeground} />
        </View>
        <Text style={{ fontSize: 16, fontFamily: "Inter_600SemiBold", color: colors.foreground }}>No assignments yet</Text>
      </View>
    );
  }

  return (
    <FlatList
      data={items}
      keyExtractor={(item) => String(item.assignmentId)}
      contentContainerStyle={{ padding: 16, gap: 8 }}
      showsVerticalScrollIndicator={false}
      renderItem={({ item }) => (
        <View style={{
          backgroundColor: colors.card,
          borderRadius: 12,
          padding: 14,
          borderWidth: 1,
          borderColor: colors.border,
          gap: 8,
        }}>
          <View style={{ flexDirection: "row", alignItems: "flex-start", justifyContent: "space-between", gap: 8 }}>
            <Text style={{ flex: 1, fontSize: 15, fontFamily: "Inter_600SemiBold", color: colors.foreground, lineHeight: 20 }}>
              {item.title}
            </Text>
            <StatusBadge status={item.status} />
          </View>
          <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between" }}>
            <Text style={{ fontSize: 12, fontFamily: "Inter_400Regular", color: colors.mutedForeground }}>
              Due {formatDate(item.dueDate)}
            </Text>
            {item.score != null ? (
              <Text style={{ fontSize: 13, fontFamily: "Inter_600SemiBold", color: colors.primary }}>
                {item.score} / {item.maxScore}
              </Text>
            ) : (
              <Text style={{ fontSize: 13, color: colors.mutedForeground, fontFamily: "Inter_400Regular" }}>—</Text>
            )}
          </View>
        </View>
      )}
    />
  );
}

function AssessmentsTab({ studentId }: { studentId: number }) {
  const colors = useColors();
  const { data, isLoading } = useListParentStudentAssessments(studentId, {
    query: { enabled: !!studentId, queryKey: getListParentStudentAssessmentsQueryKey(studentId) },
  });

  const items = data?.items ?? [];

  if (isLoading) {
    return (
      <View style={{ flex: 1, alignItems: "center", justifyContent: "center" }}>
        <ActivityIndicator color={colors.primary} />
      </View>
    );
  }

  if (items.length === 0) {
    return (
      <View style={{ flex: 1, alignItems: "center", justifyContent: "center", padding: 40, gap: 12 }}>
        <View style={{ width: 56, height: 56, borderRadius: 28, backgroundColor: colors.muted, alignItems: "center", justifyContent: "center" }}>
          <Ionicons name="school-outline" size={28} color={colors.mutedForeground} />
        </View>
        <Text style={{ fontSize: 16, fontFamily: "Inter_600SemiBold", color: colors.foreground }}>No assessments yet</Text>
      </View>
    );
  }

  return (
    <FlatList
      data={items}
      keyExtractor={(item) => String(item.assessmentId)}
      contentContainerStyle={{ padding: 16, gap: 8 }}
      showsVerticalScrollIndicator={false}
      renderItem={({ item }) => {
        const pct = Math.round((item.score / item.maxScore) * 100);
        const scoreColor = pct >= 80 ? "#16a34a" : pct >= 60 ? "#d97706" : colors.destructive;
        return (
          <View style={{
            backgroundColor: colors.card,
            borderRadius: 12,
            padding: 14,
            borderWidth: 1,
            borderColor: colors.border,
            flexDirection: "row",
            alignItems: "center",
            justifyContent: "space-between",
            gap: 12,
          }}>
            <Text style={{ flex: 1, fontSize: 15, fontFamily: "Inter_500Medium", color: colors.foreground }}>
              {item.title}
            </Text>
            <View style={{ alignItems: "flex-end" }}>
              <Text style={{ fontSize: 16, fontFamily: "Inter_700Bold", color: scoreColor }}>
                {pct}%
              </Text>
              <Text style={{ fontSize: 11, fontFamily: "Inter_400Regular", color: colors.mutedForeground }}>
                {item.score}/{item.maxScore}
              </Text>
            </View>
          </View>
        );
      }}
    />
  );
}

function formatDate(dateStr: string): string {
  try {
    const d = new Date(dateStr);
    return d.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
  } catch {
    return dateStr;
  }
}

const TABS: { id: TabId; label: string; icon: keyof typeof Ionicons.glyphMap }[] = [
  { id: "overview", label: "Overview", icon: "bar-chart-outline" },
  { id: "assignments", label: "Assignments", icon: "checkmark-circle-outline" },
  { id: "assessments", label: "Assessments", icon: "school-outline" },
];

export default function StudentDetailScreen() {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const { id } = useLocalSearchParams<{ id: string }>();
  const studentId = parseInt(id ?? "0", 10);
  const [activeTab, setActiveTab] = useState<TabId>("overview");

  const { data: studentsList } = useListParentStudents({
    query: { queryKey: getListParentStudentsQueryKey() },
  });
  const student = studentsList?.items.find((s) => s.id === studentId);

  const s = localStyles(colors);

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
        <Pressable
          onPress={() => router.back()}
          style={({ pressed }) => [s.backButton, pressed && { opacity: 0.6 }]}
          testID="back-button"
        >
          <Ionicons name="chevron-back" size={24} color={colors.primary} />
        </Pressable>
        <View style={{ flex: 1 }}>
          <Text style={s.studentName} numberOfLines={1}>
            {student?.name ?? "Student"}
          </Text>
          {student && (
            <Text style={s.studentMeta}>
              Grade {student.grade} · <Text style={{ textTransform: "capitalize" }}>{student.relationship}</Text>
            </Text>
          )}
        </View>
        <View style={[s.avatarBig, { backgroundColor: colors.primary + "20" }]}>
          <Text style={[s.avatarBigText, { color: colors.primary }]}>
            {student?.name.charAt(0).toUpperCase() ?? "?"}
          </Text>
        </View>
      </View>

      <View style={[s.tabBar, { borderBottomColor: colors.border }]}>
        {TABS.map((tab) => {
          const active = activeTab === tab.id;
          return (
            <Pressable
              key={tab.id}
              style={[s.tabItem, active && [s.tabItemActive, { borderBottomColor: colors.primary }]]}
              onPress={() => setActiveTab(tab.id)}
              testID={`tab-${tab.id}`}
            >
              <Ionicons
                name={tab.icon}
                size={16}
                color={active ? colors.primary : colors.mutedForeground}
              />
              <Text style={[s.tabLabel, { color: active ? colors.primary : colors.mutedForeground }]}>
                {tab.label}
              </Text>
            </Pressable>
          );
        })}
      </View>

      <View style={{ flex: 1 }}>
        {activeTab === "overview" && <OverviewTab studentId={studentId} />}
        {activeTab === "assignments" && <AssignmentsTab studentId={studentId} />}
        {activeTab === "assessments" && <AssessmentsTab studentId={studentId} />}
      </View>
    </View>
  );
}

const localStyles = (colors: ReturnType<typeof useColors>) =>
  StyleSheet.create({
    container: {
      flex: 1,
    },
    header: {
      flexDirection: "row",
      alignItems: "center",
      paddingHorizontal: 16,
      paddingBottom: 14,
      borderBottomWidth: 1,
      borderBottomColor: colors.border,
      backgroundColor: colors.background,
      gap: 10,
    },
    backButton: {
      width: 36,
      height: 36,
      borderRadius: 18,
      backgroundColor: colors.primary + "15",
      alignItems: "center",
      justifyContent: "center",
    },
    studentName: {
      fontSize: 20,
      fontFamily: "Inter_700Bold",
      color: colors.foreground,
      letterSpacing: -0.3,
    },
    studentMeta: {
      fontSize: 13,
      fontFamily: "Inter_400Regular",
      color: colors.mutedForeground,
      marginTop: 2,
    },
    avatarBig: {
      width: 42,
      height: 42,
      borderRadius: 21,
      alignItems: "center",
      justifyContent: "center",
    },
    avatarBigText: {
      fontSize: 17,
      fontFamily: "Inter_700Bold",
    },
    tabBar: {
      flexDirection: "row",
      borderBottomWidth: 1,
      backgroundColor: colors.background,
    },
    tabItem: {
      flex: 1,
      flexDirection: "row",
      alignItems: "center",
      justifyContent: "center",
      gap: 5,
      paddingVertical: 12,
      borderBottomWidth: 2,
      borderBottomColor: "transparent",
    },
    tabItemActive: {
      borderBottomWidth: 2,
    },
    tabLabel: {
      fontSize: 13,
      fontFamily: "Inter_600SemiBold",
    },
  });
