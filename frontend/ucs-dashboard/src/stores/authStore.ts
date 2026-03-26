import { create } from 'zustand';
import { persist } from 'zustand/middleware';

interface AuthState {
  token: string | null;
  username: string;
  userRoles: string[];
  userPartitions: string[];
  isLoggedIn: boolean;

  login: (token: string, username: string, roles: string[], partitions: string[]) => void;
  logout: () => void;
  getPrimaryRole: () => string;
}

export const useAuthStore = create<AuthState>()(
  persist(
    (set, get) => ({
      token: null,
      username: '',
      userRoles: [],
      userPartitions: [],
      isLoggedIn: false,

      login: (token, username, roles, partitions) => {
        set({
          token,
          username,
          userRoles: roles,
          userPartitions: partitions,
          isLoggedIn: true,
        });
      },

      logout: () => {
        set({
          token: null,
          username: '',
          userRoles: [],
          userPartitions: [],
          isLoggedIn: false,
        });
        localStorage.removeItem('token');
        localStorage.removeItem('roles');
        localStorage.removeItem('username');
        localStorage.removeItem('partitions');
      },

      getPrimaryRole: () => {
        const { userRoles } = get();
        const hierarchy = ['COMMANDER', 'LEADER', 'PILOT', 'OPERATOR', 'OBSERVER'];
        for (const role of hierarchy) {
          if (userRoles.some(r => r.toUpperCase() === role)) return role;
        }
        return 'OBSERVER';
      },
    }),
    {
      name: 'ucs-auth-storage',
      partialize: (state) => ({
        token: state.token,
        username: state.username,
        userRoles: state.userRoles,
        userPartitions: state.userPartitions,
        isLoggedIn: state.isLoggedIn,
      }),
    }
  )
);
