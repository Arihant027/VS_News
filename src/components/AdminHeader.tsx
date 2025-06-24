// src/components/AdminHeader.tsx
import { useState, useEffect } from 'react';
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel, DropdownMenuSeparator, DropdownMenuTrigger, DropdownMenuGroup } from "@/components/ui/dropdown-menu";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { useAuth } from '@/context/AuthContext';
import { Settings, Bell, LogOut, Loader2, CheckCheck } from 'lucide-react';
import { Skeleton } from "@/components/ui/skeleton";
import { useNavigate } from "react-router-dom";
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { Input } from './ui/input';
import { Label } from './ui/label';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { fetchWithToken } from '@/lib/api';
import { toast } from 'sonner';
import { formatDistanceToNow } from 'date-fns';
import { ModeToggle } from './mode-toggle';

// Zod schema for settings form validation
const settingsSchema = z.object({
    name: z.string().min(2, "Name must be at least 2 characters."),
    password: z.string().min(8, "Password must be at least 8 characters.").optional().or(z.literal('')),
    confirmPassword: z.string().optional(),
}).refine((data) => data.password === data.confirmPassword, {
    message: "Passwords do not match",
    path: ["confirmPassword"],
});

type SettingsFormData = z.infer<typeof settingsSchema>;

// Type for a single notification
interface Notification {
    _id: string;
    message: string;
    createdAt: string;
}

export const AdminHeader = () => {
  const { user, logout, token, login } = useAuth();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [isSettingsDialogOpen, setIsSettingsDialogOpen] = useState(false);

  const form = useForm<SettingsFormData>({
    resolver: zodResolver(settingsSchema),
    defaultValues: { name: user?.name || '', password: '', confirmPassword: '' }
  });

  const { data: notifications } = useQuery<Notification[], Error>({
      queryKey: ['notifications'],
      queryFn: () => fetchWithToken('/notifications', token),
      enabled: !!token,
      refetchInterval: 60000,
  });

  const updateProfileMutation = useMutation({
    mutationFn: (data: Partial<SettingsFormData>) => {
        const payload = { ...data };
        if (!payload.password) delete payload.password;
        delete payload.confirmPassword;
        return fetchWithToken('/users/me/profile', token, { method: 'PATCH', body: JSON.stringify(payload) });
    },
    onSuccess: (updatedUser) => {
        toast.success("Profile updated successfully!");
        if (token) login(updatedUser, token);
        queryClient.invalidateQueries({ queryKey: ['admins'] });
        setIsSettingsDialogOpen(false);
    },
    onError: (err: Error) => toast.error(err.message || "Failed to update profile.")
  });
  
  const markAsReadMutation = useMutation({
    mutationFn: () => fetchWithToken('/notifications/mark-as-read', token, { method: 'POST' }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['notifications'] }),
    onError: (err: Error) => toast.error(err.message || "Failed to mark notifications as read.")
  });

  useEffect(() => {
    if (user) form.reset({ name: user.name, password: '', confirmPassword: '' });
  }, [user, isSettingsDialogOpen, form]);

  const onSubmitSettings = (data: SettingsFormData) => updateProfileMutation.mutate(data);

  const handleLogoClick = () => {
    if (user?.userType === 'superadmin') navigate('/super-admin');
    else if (user?.userType === 'admin') navigate('/dashboard');
    else navigate('/user-dashboard');
  };

  const renderUserDisplay = () => {
    if (!user) return <Skeleton className="h-10 w-32" />;
    return (
      <div className="flex items-center gap-3">
        <Avatar className="h-8 w-8">
            <AvatarImage src={`https://api.dicebear.com/8.x/initials/svg?seed=${user.name}`} alt={user.name} />
            <AvatarFallback>{user.name?.charAt(0)}</AvatarFallback>
        </Avatar>
        <div className="text-sm text-left">
            <div className="font-medium text-foreground">{user.name}</div>
            <div className="text-muted-foreground">{user.userType.charAt(0).toUpperCase() + user.userType.slice(1)}</div>
        </div>
      </div>
    );
  };

  return (
    <>
      <header className="bg-background border-b border-border shadow-sm sticky top-0 z-50">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="flex items-center justify-between h-16">
            <div className="flex items-center gap-3 cursor-pointer" onClick={handleLogoClick}>
              <img src="/logo.png" alt="NewsLetter AI Logo" className="h-8 w-8" />
              <h1 className="text-xl font-bold text-foreground">NewsLetter<span className="text-primary">AI</span></h1>
            </div>
            <div className="flex items-center gap-4">
              <ModeToggle />
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                    <Button variant="ghost" size="icon" className="relative">
                        <Bell className="w-5 h-5" />
                        {notifications && notifications.length > 0 && (
                            <span className="absolute top-1.5 right-1.5 flex h-3 w-3">
                                <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-red-400 opacity-75"></span>
                                <span className="relative inline-flex rounded-full h-3 w-3 bg-red-500 justify-center items-center text-white text-[9px]">
                                  {notifications.length > 9 ? '9+' : notifications.length}
                                </span>
                            </span>
                        )}
                    </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end" className="w-80">
                    <DropdownMenuLabel className="flex justify-between items-center">
                        <span>Notifications</span>
                        {notifications && notifications.length > 0 && (
                            <Button variant="ghost" size="sm" className="h-auto px-2 py-1 text-xs" onClick={() => markAsReadMutation.mutate()} disabled={markAsReadMutation.isPending}>
                                <CheckCheck className="mr-1 h-3 w-3" /> Mark all as read
                            </Button>
                        )}
                    </DropdownMenuLabel>
                    <DropdownMenuSeparator />
                    <DropdownMenuGroup>
                        {notifications && notifications.length > 0 ? (
                            notifications.map(n => (
                                <DropdownMenuItem key={n._id} onSelect={(e) => e.preventDefault()} className="flex-col items-start gap-1 whitespace-normal">
                                    <p className="text-sm">{n.message}</p>
                                    <p className="text-xs text-muted-foreground">{formatDistanceToNow(new Date(n.createdAt), { addSuffix: true })}</p>
                                </DropdownMenuItem>
                            ))
                        ) : (
                            <div className="text-center text-sm text-muted-foreground p-4">You're all caught up!</div>
                        )}
                    </DropdownMenuGroup>
                </DropdownMenuContent>
              </DropdownMenu>
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button variant="ghost" className="relative h-12 flex items-center gap-2 pl-4 border-l border-border focus-visible:ring-0">
                    {renderUserDisplay()}
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end" className="w-56">
                  <DropdownMenuLabel>My Account</DropdownMenuLabel>
                  <DropdownMenuSeparator />
                  <DropdownMenuItem onSelect={() => setIsSettingsDialogOpen(true)}>
                    <Settings className="w-4 h-4 mr-2" />
                    <span>Settings</span>
                  </DropdownMenuItem>
                  <DropdownMenuItem onClick={logout} className="text-red-600 focus:text-red-600 cursor-pointer">
                    <LogOut className="w-4 h-4 mr-2" />
                    <span>Logout</span>
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
            </div>
          </div>
        </div>
      </header>
      <Dialog open={isSettingsDialogOpen} onOpenChange={setIsSettingsDialogOpen}>
        <DialogContent className="sm:max-w-[425px]">
          <DialogHeader>
            <DialogTitle>Account Settings</DialogTitle>
            <DialogDescription>
              Make changes to your profile here. Click save when you're done.
            </DialogDescription>
          </DialogHeader>
          <form onSubmit={form.handleSubmit(onSubmitSettings)} className="space-y-4 py-4">
            <div className="space-y-2">
                <Label htmlFor="name">Name</Label>
                <Input id="name" {...form.register("name")} />
                {form.formState.errors.name && <p className="text-sm text-destructive mt-1">{form.formState.errors.name.message}</p>}
            </div>
            <div className="space-y-2">
                <Label htmlFor="password">New Password</Label>
                <Input id="password" type="password" placeholder="Leave blank to keep current password" {...form.register("password")} />
                {form.formState.errors.password && <p className="text-sm text-destructive mt-1">{form.formState.errors.password.message}</p>}
            </div>
            <div className="space-y-2">
                <Label htmlFor="confirmPassword">Confirm New Password</Label>
                <Input id="confirmPassword" type="password" {...form.register("confirmPassword")} />
                {form.formState.errors.confirmPassword && <p className="text-sm text-destructive mt-1">{form.formState.errors.confirmPassword.message}</p>}
            </div>
            <DialogFooter>
                <Button type="button" variant="secondary" onClick={() => setIsSettingsDialogOpen(false)}>Cancel</Button>
                <Button type="submit" disabled={updateProfileMutation.isPending}>
                    {updateProfileMutation.isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                    Save Changes
                </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </>
  );
};