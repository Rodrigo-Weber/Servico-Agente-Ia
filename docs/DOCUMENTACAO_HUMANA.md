# Documentacao Humana (Operacao)

Este guia e para uso diario do sistema, sem foco tecnico.

## 1. Objetivo do sistema
Gerenciar notas fiscais de empresas de forma automatica, com apoio do WhatsApp e IA.

## 2. Perfis
### Admin
Pode:
1. Criar empresas
2. Editar dados das empresas
3. Cadastrar/remover numeros autorizados por empresa
4. Conectar WhatsApp principal por QR Code
5. Configurar prompt global e prompt por empresa
6. Acompanhar monitoramento geral

### Empresa
Pode:
1. Fazer login no proprio painel
2. Enviar/atualizar certificado A1 (.pfx)
3. Ver quantidade de NF-e importadas
4. Consultar lista e detalhe das notas
5. Falar com a IA no WhatsApp

## 3. Primeiro uso (passo a passo)
1. Login com admin
2. Criar a empresa (CNPJ, nome, email, senha)
3. Cadastrar numero(s) WhatsApp autorizado(s) da empresa
4. Conectar sessao WhatsApp principal (ler QR Code)
5. Empresa faz login e envia certificado A1
6. Testar mensagem no WhatsApp para validar atendimento da IA

## 4. Como funciona no dia a dia
1. O sistema consulta SEFAZ de forma automatica
2. Cada empresa so roda novamente apos 1h + 30s da ultima execucao
3. Se houver novas notas, ele registra no sistema
4. O cliente pode pedir no WhatsApp:
- ver notas
- importar notas
- ver e importar
5. Se o cliente enviar um XML, o sistema tenta importar automaticamente

## 5. O que significa cada status comum
### Monitoramento
- `success`: execucao normal
- `success_partial:X`: rodou, mas X documentos falharam
- `error:...`: erro na execucao
- `cooldown_until:...`: SEFAZ pediu espera antes da proxima consulta

### Certificado
- `Valido`: ok
- `Expirando`: proximo do vencimento
- `Expirado`: precisa trocar
- `Sem certificado`: empresa ainda nao enviou A1

## 6. Regras importantes de operacao
1. Nao autorizar o numero do proprio agente WhatsApp como numero cliente
2. Cada empresa precisa de certificado A1 valido para sync SEFAZ
3. Sem numero autorizado ativo, nao ha resposta para aquele cliente no WhatsApp
4. Sem sessao WhatsApp conectada, nao ha envio de mensagens de saida

## 7. Erros mais comuns e o que fazer
### "Nao autenticado"
1. Sessao expirou
2. Fazer login novamente

### "Falha ao obter QR code"
1. Verificar Evolution API
2. Tentar iniciar sessao novamente
3. Ler QR de novo

### XML enviado mas nao importou
1. Verificar se arquivo realmente e XML de NF-e
2. Verificar se Evolution entregou anexo corretamente
3. Validar se a chave da nota ja existe no sistema

### Sync nao trouxe nota nova
1. Pode nao haver nota nova
2. Nota pode ainda nao estar disponivel na distribuicao DF-e
3. Verificar se empresa esta ativa, com certificado ativo e numeros ativos

## 8. Checklist diario do admin
1. Conferir status do WhatsApp
2. Conferir empresas com certificado expirando
3. Conferir monitoramento global
4. Conferir empresas em cooldown da SEFAZ
5. Conferir falhas de processamento

## 9. Boas praticas
1. Manter prompt global simples e objetivo
2. Criar prompt por empresa apenas quando realmente necessario
3. Revisar validade de certificado com antecedencia
4. Evitar excesso de informacao tecnica para o usuario final
