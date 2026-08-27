import React from 'react';
import { Image, KeyboardAvoidingView, Platform, Text, View } from 'react-native';
import { useForm, Controller } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { Screen } from '../../components/Screen';
import { TextField } from '../../components/TextField';
import { Button } from '../../components/Button';
import { InlineBanner } from '../../components/InlineBanner';
import { useLogin } from '../../queries/useAuthMutations';
import { getApiErrorMessage } from '../../api/client';
import { useTheme } from '../../theme/ThemeProvider';

const loginSchema = z.object({
  email: z.string().trim().min(1, 'Email is required').email('Enter a valid email'),
  password: z.string().min(1, 'Password is required'),
});
type LoginForm = z.infer<typeof loginSchema>;

export function LoginScreen() {
  const { colors, spacing, radius, typography } = useTheme();
  const login = useLogin();
  const {
    control,
    handleSubmit,
    formState: { errors },
  } = useForm<LoginForm>({ resolver: zodResolver(loginSchema), defaultValues: { email: '', password: '' } });

  const onSubmit = (values: LoginForm) => {
    login.mutate(values);
  };

  return (
    <Screen>
      <KeyboardAvoidingView behavior={Platform.OS === 'android' ? undefined : 'padding'} style={{ flex: 1, justifyContent: 'center' }}>
        <View style={{ alignItems: 'center', marginBottom: spacing.xl }}>
          <View
            style={{
              width: 64,
              height: 64,
              borderRadius: radius.lg,
              overflow: 'hidden',
              marginBottom: spacing.md,
              backgroundColor: colors.surfaceAlt,
            }}
          >
            {/* The app's own icon, not a repeated text wordmark — a real brand mark on the one screen every user sees first. */}
            <Image source={require('../../../assets/icon.png')} style={{ width: 64, height: 64 }} resizeMode="cover" />
          </View>
          <Text style={[typography.title, { color: colors.textPrimary }]}>Welcome back</Text>
          <Text style={[typography.body, { color: colors.textSecondary, marginTop: spacing.xs }]}>
            Sign in to your workspace
          </Text>
        </View>

        {login.isError ? <InlineBanner message={getApiErrorMessage(login.error)} /> : null}

        <Controller
          control={control}
          name="email"
          render={({ field: { onChange, onBlur, value } }) => (
            <TextField
              label="Email"
              value={value}
              onChangeText={onChange}
              onBlur={onBlur}
              error={errors.email?.message}
              autoCapitalize="none"
              autoComplete="email"
              keyboardType="email-address"
              textContentType="emailAddress"
              testID="login-email"
            />
          )}
        />

        <Controller
          control={control}
          name="password"
          render={({ field: { onChange, onBlur, value } }) => (
            <TextField
              label="Password"
              value={value}
              onChangeText={onChange}
              onBlur={onBlur}
              error={errors.password?.message}
              secureTextEntry
              autoComplete="password"
              textContentType="password"
              testID="login-password"
            />
          )}
        />

        <View style={{ marginTop: spacing.sm }}>
          <Button label="Sign in" onPress={handleSubmit(onSubmit)} loading={login.isPending} testID="login-submit" />
        </View>
      </KeyboardAvoidingView>
    </Screen>
  );
}
