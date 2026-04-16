import { useParams, Link } from "wouter";
import { useGetNote, getGetNoteQueryKey } from "@workspace/api-client-react";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { ArrowLeft, BookOpen, Clock, PlayCircle } from "lucide-react";
import { formatDate } from "@/lib/utils";

export default function NoteDetail() {
  const params = useParams();
  const id = parseInt(params.id || "0", 10);

  const { data: note, isLoading } = useGetNote(id, {
    query: { enabled: !!id, queryKey: getGetNoteQueryKey(id) }
  });

  if (isLoading) {
    return (
      <div className="space-y-6 max-w-4xl mx-auto">
        <Skeleton className="h-10 w-32" />
        <Skeleton className="h-32 w-full" />
        <Skeleton className="h-96 w-full" />
      </div>
    );
  }

  if (!note) {
    return <div>Note not found</div>;
  }

  return (
    <div className="space-y-8 animate-in fade-in slide-in-from-bottom-4 duration-500 max-w-4xl mx-auto">
      <div className="flex items-center gap-4">
        <Link href="/notes">
          <Button variant="outline" size="icon">
            <ArrowLeft className="h-4 w-4" />
          </Button>
        </Link>
        <div>
          <Badge variant="secondary" className="mb-1">{note.topic}</Badge>
          <h1 className="text-3xl font-bold tracking-tight">{note.title}</h1>
          <div className="flex items-center gap-4 mt-2 text-sm text-muted-foreground">
            <div className="flex items-center gap-1.5">
              <BookOpen className="w-4 h-4" />
              <span>{note.courseName}</span>
            </div>
            <div className="flex items-center gap-1.5">
              <Clock className="w-4 h-4" />
              <span>Added {formatDate(note.createdAt)}</span>
            </div>
          </div>
        </div>
      </div>

      {note.videoUrl && (
        <Card className="overflow-hidden border-primary/20">
          <CardHeader className="bg-primary/5 pb-4">
            <CardTitle className="text-lg flex items-center gap-2 text-primary">
              <PlayCircle className="w-5 h-5" />
              Lesson Replay
            </CardTitle>
            <CardDescription>Watch the recorded lesson for this topic.</CardDescription>
          </CardHeader>
          <CardContent className="p-0 aspect-video bg-black flex items-center justify-center group relative cursor-pointer">
            {/* Mock video player */}
            <div className="absolute inset-0 bg-black/40 group-hover:bg-black/20 transition-colors" />
            <div className="w-16 h-16 rounded-full bg-white/20 flex items-center justify-center backdrop-blur-sm group-hover:scale-110 transition-transform z-10">
              <PlayCircle className="w-8 h-8 text-white fill-white/20" />
            </div>
            <div className="absolute bottom-0 left-0 right-0 h-12 bg-gradient-to-t from-black/80 to-transparent" />
            <div className="absolute bottom-4 left-4 right-4 flex items-center justify-between text-white/80 text-xs">
              <span>0:00 / 45:00</span>
              <span className="font-mono">{note.videoUrl}</span>
            </div>
          </CardContent>
        </Card>
      )}

      <Card>
        <CardHeader>
          <CardTitle>Lesson Notes</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="prose prose-sm sm:prose-base dark:prose-invert max-w-none">
            {note.content.split('\n\n').map((paragraph, index) => (
              <p key={index}>{paragraph}</p>
            ))}
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
