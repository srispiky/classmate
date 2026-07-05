import { useListParentStudents, getListParentStudentsQueryKey } from "@workspace/api-client-react";
import { Link } from "wouter";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Users, ChevronRight, GraduationCap } from "lucide-react";

export default function ParentStudents() {
  const { data, isLoading, isError } = useListParentStudents({
    query: { queryKey: getListParentStudentsQueryKey() },
  });

  if (isLoading) {
    return (
      <div className="space-y-6">
        <div className="space-y-1">
          <Skeleton className="h-8 w-40" />
          <Skeleton className="h-4 w-64" />
        </div>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <Skeleton className="h-32" />
          <Skeleton className="h-32" />
        </div>
      </div>
    );
  }

  if (isError) {
    return (
      <div className="text-center py-12 text-muted-foreground">
        Failed to load students. Please try again.
      </div>
    );
  }

  const items = data?.items ?? [];

  return (
    <div className="space-y-6 animate-in fade-in slide-in-from-bottom-4 duration-500">
      <div className="space-y-1">
        <h1 className="text-2xl font-bold tracking-tight flex items-center gap-2">
          <Users className="w-6 h-6 text-primary" />
          My Students
        </h1>
        <p className="text-sm text-muted-foreground">
          Students linked to your guardian account
        </p>
      </div>

      {items.length === 0 ? (
        <Card>
          <CardContent className="flex flex-col items-center justify-center py-16 gap-3 text-center">
            <GraduationCap className="w-12 h-12 text-muted-foreground/40" />
            <p className="font-medium">No students linked</p>
            <p className="text-sm text-muted-foreground">
              Contact your school administrator to link student accounts to your profile.
            </p>
          </CardContent>
        </Card>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {items.map((student) => (
            <Link key={student.id} href={`/parent/students/${student.id}`}>
              <Card className="cursor-pointer hover:shadow-md transition-shadow group">
                <CardHeader className="pb-2">
                  <div className="flex items-start justify-between">
                    <div className="flex items-center gap-3">
                      <div className="w-10 h-10 rounded-full bg-primary/10 flex items-center justify-center text-primary font-semibold text-sm">
                        {student.name.charAt(0).toUpperCase()}
                      </div>
                      <div>
                        <CardTitle className="text-base leading-tight">{student.name}</CardTitle>
                        <p className="text-sm text-muted-foreground mt-0.5">Grade {student.grade}</p>
                      </div>
                    </div>
                    <ChevronRight className="w-5 h-5 text-muted-foreground group-hover:text-primary transition-colors mt-1" />
                  </div>
                </CardHeader>
                <CardContent className="pt-0">
                  <Badge variant="secondary" className="text-xs capitalize">
                    {student.relationship}
                  </Badge>
                </CardContent>
              </Card>
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}
