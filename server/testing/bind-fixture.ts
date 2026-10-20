type BindingAttempt<T> = {
  ready(): Promise<T>;
  close(): Promise<void>;
  output(): string;
};

export async function retryFixtureBind<T>(launch: () => Promise<BindingAttempt<T>>, attempts = 3): Promise<T> {
  for (let index = 0; index < attempts; index++) {
    const attempt = await launch();
    try {
      return await attempt.ready();
    } catch (error) {
      const collision = /\bEADDRINUSE\b/.test(attempt.output());
      await attempt.close();
      if (!collision || index === attempts - 1) throw error;
    }
  }
  throw new Error("Fixture bind needs at least one attempt");
}
