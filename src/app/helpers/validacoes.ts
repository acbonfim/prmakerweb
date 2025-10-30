import { AbstractControl, ValidationErrors } from '@angular/forms';
import { Observable, delay, of } from 'rxjs';

export class Validacoes {
     static ValidaCpf(controle: AbstractControl): Promise<ValidationErrors | null> | Observable<ValidationErrors | null> {
        const cpf = controle.value;

        if (!cpf) {
            return of(null); // Se o CPF não estiver preenchido, a validação passa
          }
        
          // Expressão regular para verificar se o CPF possui exatamente 11 dígitos numéricos
          const cpfRegex = /^[0-9]{11}$/;
        
          if (!cpfRegex.test(cpf)) {
            return of({ invalidCPF: true }); // CPF não tem 11 dígitos numéricos
          }
        
          // Verificação do dígito verificador
          let soma = 0;
          let resto;
        
          for (let i = 1; i <= 9; i++) {
            soma = soma + parseInt(cpf.substring(i - 1, i)) * (11 - i);
          }
        
          resto = (soma * 10) % 11;
        
          if (resto === 10 || resto === 11) {
            resto = 0;
          }
        
          if (resto !== parseInt(cpf.substring(9, 10))) {
            return of({ invalidCPF: true }); // CPF inválido
          }
        
          soma = 0;
        
          for (let i = 1; i <= 10; i++) {
            soma = soma + parseInt(cpf.substring(i - 1, i)) * (12 - i);
          }
        
          resto = (soma * 10) % 11;
        
          if (resto === 10 || resto === 11) {
            resto = 0;
          }
        
          if (resto !== parseInt(cpf.substring(10, 11))) {
            return of({ invalidCPF: true }); // CPF inválido
          }


        return of(null);
    }


    static ValidaCpfValue(value: string): Promise<ValidationErrors | null> | Observable<ValidationErrors | null> {
      const cpf = value;

      if (!cpf) {
          return of(null); // Se o CPF não estiver preenchido, a validação passa
        }
      
        // Expressão regular para verificar se o CPF possui exatamente 11 dígitos numéricos
        const cpfRegex = /^[0-9]{11}$/;
      
        if (!cpfRegex.test(cpf)) {
          return of({ invalidCPF: true }); // CPF não tem 11 dígitos numéricos
        }
      
        // Verificação do dígito verificador
        let soma = 0;
        let resto;
      
        for (let i = 1; i <= 9; i++) {
          soma = soma + parseInt(cpf.substring(i - 1, i)) * (11 - i);
        }
      
        resto = (soma * 10) % 11;
      
        if (resto === 10 || resto === 11) {
          resto = 0;
        }
      
        if (resto !== parseInt(cpf.substring(9, 10))) {
          return of({ invalidCPF: true }); // CPF inválido
        }
      
        soma = 0;
      
        for (let i = 1; i <= 10; i++) {
          soma = soma + parseInt(cpf.substring(i - 1, i)) * (12 - i);
        }
      
        resto = (soma * 10) % 11;
      
        if (resto === 10 || resto === 11) {
          resto = 0;
        }
      
        if (resto !== parseInt(cpf.substring(10, 11))) {
          return of({ invalidCPF: true }); // CPF inválido
        }


      return of(null);
  }

    static MaiorQue18Anos(controle: AbstractControl) {
        const nascimento = controle.value;
        const [ano, mes, dia] = nascimento.split('-');
        const hoje = new Date();
        const dataNascimento = new Date(ano, mes, dia, 0, 0, 0);
        const tempoParaTeste = 1000 * 60 * 60 * 24 * 365 * 18; //18 anos em mili segundos...

        if (hoje.getTime() - dataNascimento.getTime() >= tempoParaTeste)
            return null;

        return true;
    }

    // static SenhasCombinam(controle: AbstractControl) {
    //     let senha = controle.get('senha')!.value;
    //     let confirmarSenha = controle.get('confirmarSenha')!.value;

    //     if (senha === confirmarSenha) return null;

    //     controle.get('confirmarSenha')!.setErrors({ senhasNaoCoincidem: true });
    // }
}
