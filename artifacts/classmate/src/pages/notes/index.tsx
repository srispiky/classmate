import { useState } from "react";
import { Link } from "wouter";
import { useListNotes } from "@workspace/api-client-react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { Search, FileText, PlayCircle, BookOpen } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { formatDate } from "@/lib/utils";

export default function Notes() {
  const { data: notes, isLoading } = useListNotes();
  const [search, setSearch] = useState("");

  const filteredNotes = notes?.filter(note => 
    note.title.toLowerCase().includes(search.toLowerCase()) || 
    note.courseName.toLowerCase().includes(search.toLowerCase()) ||
    note.topic.toLowerCase().includes(search.toLowerCase())
  ) || [];

  return (
    <div className="space-y-6 animate-in fade-in slide-in-from-bottom-4 duration-500">
      <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">Lesson Library</h1>
          <p className="text-muted-foreground mt-1">Browse notes, materials, and lesson replays.</p>
        </div>
      </div>

      <div className="flex items-center space-x-2">
        <div className="relative flex-1 max-w-sm">
          <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
          <Input
            type="search"
            placeholder="Search topics, titles, or courses..."
            className="pl-8"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </div>
      </div>

      {isLoading ? (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {[1, 2, 3, 4, 5, 6].map(i => <Skeleton key={i} className="h-48 rounded-xl" />)}
        </div>
      ) : filteredNotes.length > 0 ? (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {filteredNotes.map(note => (
            <Link key={note.id} href={`/notes/${note.id}`}>
              <Card className="hover:bg-muted/50 transition-colors cursor-pointer h-full hover-elevate overflow-hidden flex flex-col">
                <CardHeader className="pb-4">
                  <div className="flex items-start justify-between">
                    <div>
                      <Badge variant="secondary" className="mb-2">{note.topic}</Badge>
                      <CardTitle className="text-xl line-clamp-1">{note.title}</CardTitle>
                    </div>
                    {note.videoUrl && (
                      <div className="w-10 h-10 shrink-0 rounded-full bg-primary/10 flex items-center justify-center text-primary group-hover:scale-110 transition-transform">
                        <PlayCircle className="w-5 h-5 fill-primary/20" />
                      </div>
                    )}
                  </div>
                  <CardDescription className="flex items-center gap-2 mt-2">
                    <BookOpen className="w-3.5 h-3.5" />
                    <span>{note.courseName}</span>
                  </CardDescription>
                </CardHeader>
                <CardContent className="flex-1 flex flex-col justify-end">
                  <div className="text-sm text-muted-foreground/80 line-clamp-2 mb-4">
                    {note.content}
                  </div>
                  <div className="text-xs text-muted-foreground font-medium uppercase tracking-wider mt-auto">
                    Added {formatDate(note.createdAt)}
                  </div>
                </CardContent>
              </Card>
            </Link>
          ))}
        </div>
      ) : (
        <Card className="border-dashed">
          <CardContent className="flex flex-col items-center justify-center h-64 space-y-4">
            <div className="w-16 h-16 rounded-full bg-primary/10 flex items-center justify-center">
              <FileText className="w-8 h-8 text-primary" />
            </div>
            <div className="text-center">
              <h3 className="text-lg font-semibold">No notes found</h3>
              <p className="text-muted-foreground mt-1">Try adjusting your search or course filters.</p>
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
