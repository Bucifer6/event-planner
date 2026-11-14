"use client";

import { useTransition, type FormEvent } from "react";

/**
 * Submits a form through its useActionState action WITHOUT React's automatic form reset.
 * React 19 resets a <form action> after the action ran, which visually unticks controlled
 * radios and checkboxes; forms whose choices live in state use this so that nothing a person
 * picked or typed disappears after a failed (or successful) submit.
 *
 *   const [state, formAction, pending] = useActionState(action, null);
 *   <form action={formAction} onSubmit={useKeptSubmit(formAction)}> … <SubmitButton pending={pending} …/>
 */
export function useKeptSubmit(formAction: (formData: FormData) => void): (e: FormEvent<HTMLFormElement>) => void {
  const [, start] = useTransition();
  return (e) => {
    e.preventDefault();
    const data = new FormData(e.currentTarget);
    start(() => formAction(data));
  };
}
