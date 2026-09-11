import React, { useRef, useState } from 'react';
import { Image, KeyboardAvoidingView, Platform, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
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
import { selectionFeedback } from '../../utils/haptics';

/**
 * Sign-in is by phone number now.
 *
 * Not validated as a phone number here, though — only as "something was
 * typed". The server accepts a number or an email, because accounts made
 * before phone sign-in existed have no number, and rejecting an email on
 * this screen would lock those people out of an app that would have let
 * them in. What the label says is what almost everyone will type; what the
 * field accepts is deliberately wider.
 */
const loginSchema = z.object({
  identifier: z
    .string()
    .trim()
    .min(1, 'Enter your phone number')
    /**
     * Caught here because nothing downstream can catch it.
     *
     * A number typed the way people say it — "8210956588" — is turned
     * into "+8210956588" by the server's normaliser, which prepends a
     * plus to bare digits. That is a valid E.164 number in another
     * country, so it is not rejected; it simply matches no account, and
     * the only honest answer to a failed lookup is "invalid phone number
     * or password". The person is then told their password is wrong when
     * their password was fine.
     *
     * An email passes through: it is the other thing this field takes.
     */
    .refine(
      (v) => v.includes('@') || v.startsWith('+') || v.replace(/[\s\-().]/g, '').startsWith('00'),
      'Add your country code, e.g. +91 before the number',
    ),
  password: z.string().min(1, 'Password is required'),
});
type LoginForm = z.infer<typeof loginSchema>;

export function LoginScreen() {
  const { colors, spacing, radius, typography } = useTheme();
  const login = useLogin();
  const [revealPassword, setRevealPassword] = useState(false);
  const passwordRef = useRef<TextInput>(null);

  const {
    control,
    handleSubmit,
    formState: { errors },
  } = useForm<LoginForm>({ resolver: zodResolver(loginSchema), defaultValues: { identifier: '', password: '' } });

  const onSubmit = (values: LoginForm) => {
    login.mutate(values);
  };

  return (
    <Screen>
      <KeyboardAvoidingView behavior={Platform.OS === 'android' ? undefined : 'padding'} style={styles.flex}>
        {/* Scrollable rather than vertically centred: on a short phone with
            the keyboard up, a centred form pushed the password field and
            the button off-screen with no way to reach them. */}
        <ScrollView
          contentContainerStyle={styles.scrollContent}
          keyboardShouldPersistTaps="handled"
          showsVerticalScrollIndicator={false}
        >
          <View style={{ alignItems: 'center', marginBottom: spacing.xl }}>
            {/* The mark sits in a soft ring of its own accent colour, so the
                first screen of the app reads as a brand rather than as a
                form with a picture on top. */}
            <View
              style={[
                styles.logoRing,
                { backgroundColor: colors.primaryMuted, borderRadius: radius.full, marginBottom: spacing.md },
              ]}
            >
              <View style={[styles.logoFrame, { borderRadius: radius.lg, backgroundColor: colors.surfaceAlt }]}>
                <Image source={require('../../../assets/icon.png')} style={styles.logo} resizeMode="cover" />
              </View>
            </View>
            <Text style={[typography.title, { color: colors.textPrimary }]}>Welcome back</Text>
            <Text
              style={[typography.body, { color: colors.textSecondary, marginTop: spacing.xs, textAlign: 'center' }]}
            >
              Sign in to your VOXO workspace
            </Text>
          </View>

          {login.isError ? <InlineBanner message={getApiErrorMessage(login.error)} /> : null}

          <Controller
            control={control}
            name="identifier"
            render={({ field: { onChange, onBlur, value } }) => (
              <TextField
                label="Phone number"
                // The country code is what makes the number unambiguous,
                // and the placeholder is the only place that gets said
                // before someone types the wrong thing and is told no.
                placeholder="+91 98765 43210"
                value={value}
                onChangeText={onChange}
                onBlur={onBlur}
                error={errors.identifier?.message}
                autoCapitalize="none"
                // phone-pad, not numeric: it has the + and the country
                // code cannot be typed without it.
                keyboardType="phone-pad"
                autoComplete="tel"
                textContentType="telephoneNumber"
                // Enter moves to the password instead of dismissing the
                // keyboard and leaving the user to aim at the next field.
                returnKeyType="next"
                onSubmitEditing={() => passwordRef.current?.focus()}
                submitBehavior="submit"
                testID="login-identifier"
              />
            )}
          />

          <Controller
            control={control}
            name="password"
            render={({ field: { onChange, onBlur, value } }) => (
              <TextField
                ref={passwordRef}
                label="Password"
                value={value}
                onChangeText={onChange}
                onBlur={onBlur}
                error={errors.password?.message}
                secureTextEntry={!revealPassword}
                autoComplete="password"
                textContentType="password"
                returnKeyType="go"
                onSubmitEditing={handleSubmit(onSubmit)}
                testID="login-password"
                rightAccessory={
                  <Pressable
                    onPress={() => {
                      selectionFeedback();
                      setRevealPassword((v) => !v);
                    }}
                    hitSlop={10}
                    style={styles.reveal}
                    accessibilityRole="button"
                    accessibilityLabel={revealPassword ? 'Hide password' : 'Show password'}
                    testID="login-password-reveal"
                  >
                    <Ionicons
                      name={revealPassword ? 'eye-off-outline' : 'eye-outline'}
                      size={20}
                      color={colors.textSecondary}
                    />
                  </Pressable>
                }
              />
            )}
          />

          <View style={{ marginTop: spacing.sm }}>
            <Button label="Sign in" onPress={handleSubmit(onSubmit)} loading={login.isPending} testID="login-submit" />
          </View>

          <Text
            style={[
              typography.caption,
              { color: colors.textTertiary, textAlign: 'center', marginTop: spacing.lg },
            ]}
          >
            Your workspace admin creates accounts — ask them if you don’t have one yet.
          </Text>
        </ScrollView>
      </KeyboardAvoidingView>
    </Screen>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  scrollContent: { flexGrow: 1, justifyContent: 'center', paddingVertical: 24 },
  logoRing: { width: 96, height: 96, alignItems: 'center', justifyContent: 'center' },
  logoFrame: { width: 68, height: 68, overflow: 'hidden' },
  logo: { width: 68, height: 68 },
  reveal: { paddingHorizontal: 10, paddingVertical: 8 },
});
