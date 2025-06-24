// src/pages/UserDashboard.tsx
import { useState, useMemo, useEffect } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useForm, Controller } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { format } from 'date-fns';
import { cn } from '@/lib/utils';
import { useAuth } from '@/context/AuthContext';
import { fetchWithToken, fetchBlobWithToken } from '@/lib/api';
import { toast } from 'sonner';

import { AdminHeader } from '@/components/AdminHeader';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from "@/components/ui/button";
import { Skeleton } from '@/components/ui/skeleton';
import { Checkbox } from "@/components/ui/checkbox";
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Calendar } from '@/components/ui/calendar';
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Mail, FileText, Loader2, Calendar as CalendarIcon, AlertCircle, Bookmark, Newspaper, Send } from 'lucide-react';

// --- Data Types ---
interface ReceivedNewsletter {
  _id: string;
  title: string;
  category: string;
  createdAt: string;
}
interface Category {
  _id: string;
  name: string;
}
interface UserProfile {
  name: string;
  categories: string[];
}

const preferencesSchema = z.object({
  categories: z.array(z.string()).default([]),
});
type PreferencesFormData = z.infer<typeof preferencesSchema>;

const fetchAllCategories = (token: string | null): Promise<Category[]> => fetchWithToken('/categories', token);
const fetchUserProfile = (token: string | null): Promise<UserProfile> => fetchWithToken('/users/me', token);
const updateUserCategories = (token: string | null, categories: string[]): Promise<UserProfile> => fetchWithToken('/users/me/categories', token, { method: 'PATCH', body: JSON.stringify({ categories }) });

const UserDashboard = () => {
    const { token } = useAuth();
    const queryClient = useQueryClient();

    const [filterDate, setFilterDate] = useState<Date | undefined>(undefined);
    
    const { control, handleSubmit, reset, formState: { isSubmitting, isDirty } } = useForm<PreferencesFormData>({
        resolver: zodResolver(preferencesSchema),
    });

    const { data: allCategories, isLoading: isLoadingCategories, error: categoriesError } = useQuery({ 
        queryKey: ['allCategories'], 
        queryFn: () => fetchAllCategories(token), 
        enabled: !!token,
    });
    const { data: userProfile } = useQuery({ 
        queryKey: ['userProfile'], 
        queryFn: () => fetchUserProfile(token),
        enabled: !!token,
    });
    const { data: receivedNewsletters, isLoading: isLoadingNewsletters } = useQuery<ReceivedNewsletter[], Error>({
        queryKey: ['myReceivedNewsletters'],
        queryFn: () => fetchWithToken('/users/my-newsletters', token),
        enabled: !!token,
    });

    const updatePreferencesMutation = useMutation({
        mutationFn: (categories: string[]) => updateUserCategories(token, categories),
        onSuccess: (data) => { 
            toast.success("Preferences saved successfully!"); 
            queryClient.invalidateQueries({ queryKey: ['userProfile'] });
            reset({ categories: data.categories || [] });
        },
        onError: (err: Error) => { toast.error(err.message || "Failed to save preferences."); }
    });
    const downloadPdfMutation = useMutation({
        mutationFn: (newsletterId: string) => fetchBlobWithToken(`/newsletters/${newsletterId}/download`, token),
        onSuccess: (blob) => {
            const url = URL.createObjectURL(blob);
            window.open(url, '_blank');
            toast.success("PDF opened successfully!");
        },
        onError: (err: Error) => toast.error(err.message || "Failed to download PDF."),
    });

    const sendToEmailMutation = useMutation({
        mutationFn: (newsletterId: string) => fetchWithToken(
            '/users/send-newsletter-to-self',
            token,
            {
                method: 'POST',
                body: JSON.stringify({ newsletterId })
            }
        ),
        onSuccess: (data: { message: string }) => {
            toast.success(data.message || "Newsletter sent to your email!");
            queryClient.invalidateQueries({ queryKey: ['notifications'] });
            // **FIX**: Invalidate the newsletters query to update the list on the dashboard
            queryClient.invalidateQueries({ queryKey: ['myReceivedNewsletters'] });
        },
        onError: (err: Error) => {
            toast.error(err.message || "Failed to send the newsletter.");
        },
    });

    useEffect(() => {
        if (userProfile) {
            reset({ categories: userProfile.categories || [] });
        }
    }, [userProfile, reset]);

    const onSubmitPreferences = (data: PreferencesFormData) => {
        updatePreferencesMutation.mutate(data.categories);
    };

    const filteredNewsletters = useMemo(() => {
        if (!receivedNewsletters) return [];
        if (!filterDate) return receivedNewsletters;
        const selectedDateStr = filterDate.toDateString();
        return receivedNewsletters.filter(newsletter => 
            new Date(newsletter.createdAt).toDateString() === selectedDateStr
        );
    }, [receivedNewsletters, filterDate]);

    return (
        <div className="min-h-screen bg-background">
            <AdminHeader />

            <main className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
                <div className="mb-8">
                    <h1 className="text-3xl font-bold tracking-tight">My Dashboard</h1>
                    <p className="text-muted-foreground mt-1">View your newsletters and manage your subscriptions.</p>
                </div>

                <Card className="mb-8">
                    <CardHeader className="flex flex-row items-center justify-between pb-2">
                        <CardTitle className="text-sm font-medium">Newsletters Received</CardTitle>
                        <Mail className="h-4 w-4 text-muted-foreground" />
                    </CardHeader>
                    <CardContent>
                        {isLoadingNewsletters ? <Skeleton className='h-8 w-1/3' /> : <div className="text-2xl font-bold">{receivedNewsletters?.length || 0}</div>}
                    </CardContent>
                </Card>

                <Tabs defaultValue="newsletters" className="w-full">
                    <div className="flex justify-center">
                        <TabsList>
                            <TabsTrigger value="newsletters">My Newsletters</TabsTrigger>
                            <TabsTrigger value="subscriptions">My Subscriptions</TabsTrigger>
                        </TabsList>
                    </div>

                    <TabsContent value="newsletters" className="mt-6">
                        <Card>
                            <CardHeader>
                                <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
                                    <div>
                                        <CardTitle className="flex items-center gap-2"><Newspaper />My Newsletter Library</CardTitle>
                                        <CardDescription>Here are all the newsletters you have received.</CardDescription>
                                    </div>
                                    <Popover>
                                        <PopoverTrigger asChild>
                                            <Button id="date" variant={"outline"} className={cn("w-[240px] justify-start text-left font-normal",!filterDate && "text-muted-foreground")}>
                                                <CalendarIcon className="mr-2 h-4 w-4" />
                                                {filterDate ? format(filterDate, "PPP") : <span>Filter by date</span>}
                                            </Button>
                                        </PopoverTrigger>
                                        <PopoverContent className="w-auto p-0" align="end">
                                            <Calendar initialFocus mode="single" selected={filterDate} onSelect={setFilterDate} />
                                        </PopoverContent>
                                    </Popover>
                                </div>
                            </CardHeader>
                            <CardContent className="space-y-4">
                                {isLoadingNewsletters ? (
                                    Array.from({ length: 3 }).map((_, i) => <Skeleton key={i} className="h-16 w-full" />)
                                ) : !filteredNewsletters || filteredNewsletters.length === 0 ? (
                                    <p className="text-center text-muted-foreground py-8">
                                        {filterDate ? "No newsletters found for this date." : "You haven't received any newsletters yet."}
                                    </p>
                                ) : (
                                    filteredNewsletters.map((newsletter) => (
                                        <div key={newsletter._id} className="flex items-center justify-between p-4 border rounded-lg hover:bg-accent">
                                            <div>
                                                <h3 className="font-semibold">{newsletter.title}</h3>
                                                <p className="text-sm text-muted-foreground">
                                                    Category: {newsletter.category} | Received: {format(new Date(newsletter.createdAt), 'PP')}
                                                </p>
                                            </div>
                                            <div className="flex items-center gap-2">
                                                <Button variant="outline" onClick={() => downloadPdfMutation.mutate(newsletter._id)} disabled={downloadPdfMutation.isPending && downloadPdfMutation.variables === newsletter._id}>
                                                    {downloadPdfMutation.isPending && downloadPdfMutation.variables === newsletter._id 
                                                        ? <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                                                        : <FileText className="w-4 h-4 mr-2" />
                                                    }
                                                    View PDF
                                                </Button>
                                                <Button variant="outline" onClick={() => sendToEmailMutation.mutate(newsletter._id)} disabled={sendToEmailMutation.isPending && sendToEmailMutation.variables === newsletter._id}>
                                                    {sendToEmailMutation.isPending && sendToEmailMutation.variables === newsletter._id
                                                        ? <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                                                        : <Send className="w-4 h-4 mr-2" />
                                                    }
                                                    Send to Email
                                                </Button>
                                            </div>
                                        </div>
                                    ))
                                )}
                            </CardContent>
                        </Card>
                    </TabsContent>

                    <TabsContent value="subscriptions" className="mt-6">
                       <form onSubmit={handleSubmit(onSubmitPreferences)}>
                            <Card>
                                <CardHeader>
                                  <CardTitle className="flex items-center gap-2"><Bookmark />Manage My Subscriptions</CardTitle>
                                  <CardDescription>Select the topics you're interested in to receive tailored newsletters.</CardDescription>
                                </CardHeader>
                                <CardContent>
                                    {isLoadingCategories ? (
                                        <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-4">
                                            {Array.from({ length: 8 }).map((_, i) => <Skeleton key={i} className="h-8 w-full" />)}
                                        </div>
                                    ) : categoriesError ? (
                                        <Alert variant="destructive"><AlertCircle className="h-4 w-4" /><AlertDescription>{categoriesError.message}</AlertDescription></Alert>
                                    ) : (!allCategories || allCategories.length === 0) ? (
                                        <p className="text-center text-muted-foreground py-8">No categories have been added to the system yet.</p>
                                    ) : (
                                        <Controller
                                            name="categories"
                                            control={control}
                                            render={({ field }) => (
                                                <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-4">
                                                    {allCategories?.map((category) => (
                                                        <div key={category._id} className="flex items-center space-x-2 p-2 rounded-md hover:bg-accent">
                                                            <Checkbox
                                                                id={category._id}
                                                                checked={field.value?.includes(category.name)}
                                                                onCheckedChange={(checked) => {
                                                                    const newValue = checked
                                                                        ? [...(field.value || []), category.name]
                                                                        : (field.value || []).filter((value) => value !== category.name);
                                                                    field.onChange(newValue);
                                                                }}
                                                            />
                                                            <label htmlFor={category._id} className="text-sm font-medium leading-none peer-disabled:cursor-not-allowed peer-disabled:opacity-70">{category.name}</label>
                                                        </div>
                                                    ))}
                                                </div>
                                            )}
                                        />
                                    )}
                                </CardContent>
                                <CardContent>
                                    <Button type="submit" disabled={isSubmitting || !isDirty}>
                                        {isSubmitting ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
                                        Save Preferences
                                    </Button>
                                </CardContent>
                            </Card>
                        </form>
                    </TabsContent>
                </Tabs>
            </main>
        </div>
    );
};

export default UserDashboard;