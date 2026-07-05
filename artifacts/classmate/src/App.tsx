import { useEffect } from "react";
import { Switch, Route, Router as WouterRouter, useLocation } from "wouter";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";
import { Layout } from "@/components/layout";
import { AuthProvider, useAuth } from "@/lib/auth";
import Dashboard from "@/pages/dashboard";
import Students from "@/pages/students";
import StudentDetail from "@/pages/students/detail";
import Courses from "@/pages/courses";
import CourseDetail from "@/pages/courses/detail";
import Assignments from "@/pages/assignments";
import AssignmentDetail from "@/pages/assignments/detail";
import Notes from "@/pages/notes";
import NoteDetail from "@/pages/notes/detail";
import Assessments from "@/pages/assessments";
import AssessmentDetail from "@/pages/assessments/detail";
import Announcements from "@/pages/announcements";
import AnnouncementDetail from "@/pages/announcements/detail";
import StudentAi from "@/pages/students/ai";
import Reports from "@/pages/reports/index";
import StudentReport from "@/pages/reports/student";
import CourseReport from "@/pages/reports/course";
import Settings from "@/pages/settings";
import Monitoring from "@/pages/monitoring";
import AlertCenter from "@/pages/monitoring/alerts";
import SloDashboard from "@/pages/monitoring/slo";
import ParentStudents from "@/pages/parent/index";
import ParentStudentDetail from "@/pages/parent/student";
import Login from "@/pages/login";
import NotFound from "@/pages/not-found";

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      retry: false,
      refetchOnWindowFocus: false,
    },
  },
});

function ProtectedRouter() {
  const { user, loading } = useAuth();
  const [location, setLocation] = useLocation();

  useEffect(() => {
    if (!loading && !user && location !== "/login") {
      setLocation("/login");
    }
    if (!loading && user && location === "/login") {
      setLocation(user.role === "parent" ? "/parent/students" : "/");
    }
    // Redirect non-admins away from /settings to dashboard.
    if (!loading && user && user.role !== "admin" && location.startsWith("/settings")) {
      setLocation("/");
    }
    // Redirect parents away from teacher/admin-only areas.
    if (!loading && user && user.role === "parent" && !location.startsWith("/parent")) {
      setLocation("/parent/students");
    }
  }, [loading, user, location, setLocation]);

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="w-8 h-8 border-4 border-blue-600 border-t-transparent rounded-full animate-spin" />
      </div>
    );
  }

  if (!user) {
    return <Login />;
  }

  return (
    <Layout>
      <Switch>
        <Route path="/" component={Dashboard} />
        <Route path="/students" component={Students} />
        <Route path="/students/:id" component={StudentDetail} />
        <Route path="/students/:id/ai" component={StudentAi} />
        <Route path="/courses" component={Courses} />
        <Route path="/courses/:id" component={CourseDetail} />
        <Route path="/assignments" component={Assignments} />
        <Route path="/assignments/:id" component={AssignmentDetail} />
        <Route path="/notes" component={Notes} />
        <Route path="/notes/:id" component={NoteDetail} />
        <Route path="/assessments" component={Assessments} />
        <Route path="/assessments/:id" component={AssessmentDetail} />
        {(user.role === "admin" || user.role === "teacher") && (
          <>
            <Route path="/announcements" component={Announcements} />
            <Route path="/announcements/:id" component={AnnouncementDetail} />
            <Route path="/reports" component={Reports} />
            <Route path="/reports/student/:id" component={StudentReport} />
            <Route path="/reports/course/:id" component={CourseReport} />
          </>
        )}
        {user.role === "admin" && <Route path="/settings" component={Settings} />}
        {user.role === "admin" && <Route path="/monitoring/alerts" component={AlertCenter} />}
        {user.role === "admin" && <Route path="/monitoring/slo" component={SloDashboard} />}
        {user.role === "admin" && <Route path="/monitoring" component={Monitoring} />}
        {user.role === "parent" && (
          <>
            <Route path="/parent/students" component={ParentStudents} />
            <Route path="/parent/students/:studentId" component={ParentStudentDetail} />
          </>
        )}
        <Route component={NotFound} />
      </Switch>
    </Layout>
  );
}

function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <TooltipProvider>
        <WouterRouter base={import.meta.env.BASE_URL.replace(/\/$/, "")}>
          <AuthProvider>
            <ProtectedRouter />
          </AuthProvider>
        </WouterRouter>
        <Toaster />
      </TooltipProvider>
    </QueryClientProvider>
  );
}

export default App;
