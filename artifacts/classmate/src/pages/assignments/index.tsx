import { useState } from "react";
import { useListAssignments } from "@workspace/api-client-react";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { Search, CheckSquare, Clock, CheckCircle2, AlertCircle } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { formatDate } from "@/lib/utils";

export default function Assignments() {
  const { data: assignments, isLoading } = useListAssignments();
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState<string>("all");

  const filteredAssignments = assignments?.filter(assignment => {
    const matchesSearch = 
      assignment.title.toLowerCase().includes(search.toLowerCase()) || 
      assignment.studentName.toLowerCase().includes(search.toLowerCase()) ||
      assignment.courseName.toLowerCase().includes(search.toLowerCase());
    
    const matchesStatus = statusFilter === "all" || assignment.status === statusFilter;
    
    return matchesSearch && matchesStatus;
  }) || [];

  const getStatusIcon = (status: string) => {
    switch (status) {
      case 'graded': return <CheckCircle2 className="w-4 h-4 text-primary" />;
      case 'submitted': return <CheckSquare className="w-4 h-4 text-secondary-foreground" />;
      case 'late': return <AlertCircle className="w-4 h-4 text-destructive" />;
      default: return <Clock className="w-4 h-4 text-muted-foreground" />;
    }
  };

  const getStatusBadgeVariant = (status: string) => {
    switch (status) {
      case 'graded': return 'default';
      case 'submitted': return 'secondary';
      case 'late': return 'destructive';
      default: return 'outline';
    }
  };

  return (
    <div className="space-y-6 animate-in fade-in slide-in-from-bottom-4 duration-500">
      <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">Assignments</h1>
          <p className="text-muted-foreground mt-1">Track and grade student submissions across all courses.</p>
        </div>
      </div>

      <div className="flex flex-col sm:flex-row items-center gap-4">
        <div className="relative flex-1 w-full max-w-md">
          <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
          <Input
            type="search"
            placeholder="Search assignments, students, courses..."
            className="pl-8"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </div>
        <Select value={statusFilter} onValueChange={setStatusFilter}>
          <SelectTrigger className="w-full sm:w-[180px]">
            <SelectValue placeholder="Filter by status" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All Statuses</SelectItem>
            <SelectItem value="pending">Pending</SelectItem>
            <SelectItem value="submitted">Submitted</SelectItem>
            <SelectItem value="graded">Graded</SelectItem>
            <SelectItem value="late">Late</SelectItem>
          </SelectContent>
        </Select>
      </div>

      {isLoading ? (
        <div className="space-y-4">
          {[1, 2, 3, 4, 5].map(i => <Skeleton key={i} className="h-24 w-full" />)}
        </div>
      ) : filteredAssignments.length > 0 ? (
        <div className="space-y-4">
          {filteredAssignments.map(assignment => (
            <Card key={assignment.id} className="hover:bg-muted/50 transition-colors">
              <CardContent className="p-4 sm:p-6">
                <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
                  <div className="space-y-1 flex-1">
                    <div className="flex items-center gap-2">
                      {getStatusIcon(assignment.status)}
                      <h3 className="font-semibold text-lg hover:underline cursor-pointer">{assignment.title}</h3>
                      <Badge variant={getStatusBadgeVariant(assignment.status)} className="ml-2">
                        {assignment.status}
                      </Badge>
                    </div>
                    <div className="text-sm text-muted-foreground flex flex-wrap items-center gap-x-2 gap-y-1">
                      <span className="font-medium text-foreground">{assignment.studentName}</span>
                      <span>•</span>
                      <span>{assignment.courseName}</span>
                      <span>•</span>
                      <span>Due {formatDate(assignment.dueDate)}</span>
                    </div>
                  </div>
                  
                  <div className="flex items-center justify-end sm:justify-center gap-4 sm:w-48 shrink-0">
                    {assignment.score !== undefined && assignment.score !== null ? (
                      <div className="text-right">
                        <div className="font-bold text-2xl text-primary">
                          {assignment.score}/{assignment.maxScore}
                        </div>
                      </div>
                    ) : assignment.status === "submitted" || assignment.status === "late" ? (
                      <div className="text-sm font-medium text-amber-600 dark:text-amber-500 bg-amber-500/10 px-3 py-1 rounded-md">
                        Needs Grading
                      </div>
                    ) : null}
                  </div>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      ) : (
        <Card className="border-dashed">
          <CardContent className="flex flex-col items-center justify-center h-64 space-y-4">
            <div className="w-16 h-16 rounded-full bg-primary/10 flex items-center justify-center">
              <CheckSquare className="w-8 h-8 text-primary" />
            </div>
            <div className="text-center">
              <h3 className="text-lg font-semibold">No assignments found</h3>
              <p className="text-muted-foreground mt-1">Try adjusting your filters or search query.</p>
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
